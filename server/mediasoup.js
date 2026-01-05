const mediasoup = require('mediasoup');
const config = require('./config');

let worker;
let router;

// Store for transports, producers, and consumers
const transports = new Map();
const producers = new Map();
const consumers = new Map();

async function initializeMediasoup() {
  // Create mediasoup worker
  worker = await mediasoup.createWorker({
    logLevel: config.mediasoup.worker.logLevel,
    logTags: config.mediasoup.worker.logTags,
    rtcMinPort: config.mediasoup.worker.rtcMinPort,
    rtcMaxPort: config.mediasoup.worker.rtcMaxPort
  });

  worker.on('died', () => {
    console.error('Mediasoup worker died, exiting...');
    process.exit(1);
  });

  // Create router
  router = await worker.createRouter({
    mediaCodecs: config.mediasoup.router.mediaCodecs
  });

  console.log(`Mediasoup worker PID: ${worker.pid}`);
  console.log(`Router ID: ${router.id}`);

  return { worker, router };
}

async function createWebRtcTransport(clientId, announcedIp = null) {
  // Get announced IP - try to detect it if not provided
  let listenIps = config.mediasoup.webRtcTransport.listenIps;
  
  if (announcedIp || !listenIps[0].announcedIp) {
    const localIPs = config.getLocalIPs();
    const detectedIp = announcedIp || localIPs[0]?.address || '127.0.0.1';
    listenIps = [{ ip: '0.0.0.0', announcedIp: detectedIp }];
  }

  const transportOptions = {
    ...config.mediasoup.webRtcTransport,
    listenIps,
    enableSctp: false,
    numSctpStreams: { OS: 0, MIS: 0 },
    appData: { clientId }
  };

  const transport = await router.createWebRtcTransport(transportOptions);

  transport.on('dtlsstatechange', (dtlsState) => {
    if (dtlsState === 'closed') {
      console.log(`Transport ${transport.id} closed for client ${clientId}`);
      transport.close();
    }
  });

  transport.on('close', () => {
    console.log(`Transport ${transport.id} closed`);
    transports.delete(transport.id);
  });

  transports.set(transport.id, { transport, clientId });

  return {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters
  };
}

async function connectTransport(transportId, dtlsParameters) {
  const transportData = transports.get(transportId);
  if (!transportData) {
    throw new Error(`Transport ${transportId} not found`);
  }

  await transportData.transport.connect({ dtlsParameters });
  console.log(`Transport ${transportId} connected`);
}

async function createProducer(transportId, kind, rtpParameters, clientId, deviceName) {
  const transportData = transports.get(transportId);
  if (!transportData) {
    throw new Error(`Transport ${transportId} not found`);
  }

  const producer = await transportData.transport.produce({
    kind,
    rtpParameters,
    appData: { clientId, deviceName, kind }
  });

  producer.on('transportclose', () => {
    console.log(`Producer ${producer.id} transport closed`);
    producers.delete(producer.id);
  });

  producer.on('close', () => {
    console.log(`Producer ${producer.id} closed`);
    producers.delete(producer.id);
  });

  producers.set(producer.id, { producer, clientId, deviceName, kind });

  console.log(`Created ${kind} producer ${producer.id} for ${deviceName || clientId}`);

  return { id: producer.id };
}

async function createConsumer(transportId, producerId, rtpCapabilities, clientId) {
  const transportData = transports.get(transportId);
  if (!transportData) {
    throw new Error(`Transport ${transportId} not found`);
  }

  const producerData = producers.get(producerId);
  if (!producerData) {
    throw new Error(`Producer ${producerId} not found`);
  }

  // Check if router can consume
  if (!router.canConsume({ producerId, rtpCapabilities })) {
    throw new Error(`Cannot consume producer ${producerId}`);
  }

  const consumer = await transportData.transport.consume({
    producerId,
    rtpCapabilities,
    paused: true, // Start paused, resume after connection
    appData: { clientId, producerId }
  });

  consumer.on('transportclose', () => {
    console.log(`Consumer ${consumer.id} transport closed`);
    consumers.delete(consumer.id);
  });

  consumer.on('producerclose', () => {
    console.log(`Consumer ${consumer.id} producer closed`);
    consumers.delete(consumer.id);
  });

  consumer.on('close', () => {
    console.log(`Consumer ${consumer.id} closed`);
    consumers.delete(consumer.id);
  });

  consumers.set(consumer.id, { consumer, clientId, producerId });

  console.log(`Created consumer ${consumer.id} for producer ${producerId}`);

  return {
    id: consumer.id,
    producerId: producerId,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
    producerPaused: consumer.producerPaused
  };
}

async function resumeConsumer(consumerId) {
  const consumerData = consumers.get(consumerId);
  if (!consumerData) {
    throw new Error(`Consumer ${consumerId} not found`);
  }

  await consumerData.consumer.resume();
  console.log(`Consumer ${consumerId} resumed`);
}

async function closeProducer(producerId) {
  const producerData = producers.get(producerId);
  if (producerData) {
    producerData.producer.close();
    producers.delete(producerId);
    console.log(`Producer ${producerId} closed`);
  }
}

async function closeTransport(transportId) {
  const transportData = transports.get(transportId);
  if (transportData) {
    transportData.transport.close();
    transports.delete(transportId);
    console.log(`Transport ${transportId} closed`);
  }
}

function getRouterRtpCapabilities() {
  return router.rtpCapabilities;
}

function getProducers() {
  return Array.from(producers.entries()).map(([id, data]) => ({
    id,
    clientId: data.clientId,
    deviceName: data.deviceName,
    kind: data.kind
  }));
}

function getProducersByClient(clientId) {
  return Array.from(producers.entries())
    .filter(([_, data]) => data.clientId === clientId)
    .map(([id, data]) => ({
      id,
      kind: data.kind
    }));
}

function cleanupClient(clientId) {
  // Close all producers for this client
  for (const [producerId, data] of producers.entries()) {
    if (data.clientId === clientId) {
      data.producer.close();
      producers.delete(producerId);
    }
  }

  // Close all consumers for this client
  for (const [consumerId, data] of consumers.entries()) {
    if (data.clientId === clientId) {
      data.consumer.close();
      consumers.delete(consumerId);
    }
  }

  // Close all transports for this client
  for (const [transportId, data] of transports.entries()) {
    if (data.clientId === clientId) {
      data.transport.close();
      transports.delete(transportId);
    }
  }

  console.log(`Cleaned up resources for client ${clientId}`);
}

// Create plain RTP transport for recording
async function createPlainRtpTransport(producerId) {
  const producerData = producers.get(producerId);
  if (!producerData) {
    throw new Error(`Producer ${producerId} not found`);
  }

  const transport = await router.createPlainTransport({
    listenIp: config.mediasoup.plainRtpTransport.listenIp,
    rtcpMux: config.mediasoup.plainRtpTransport.rtcpMux,
    comedia: config.mediasoup.plainRtpTransport.comedia
  });

  return {
    transport,
    producer: producerData.producer,
    deviceName: producerData.deviceName,
    clientId: producerData.clientId
  };
}

module.exports = {
  initializeMediasoup,
  createWebRtcTransport,
  connectTransport,
  createProducer,
  createConsumer,
  resumeConsumer,
  closeProducer,
  closeTransport,
  getRouterRtpCapabilities,
  getProducers,
  getProducersByClient,
  cleanupClient,
  createPlainRtpTransport,
  get router() { return router; },
  get transports() { return transports; },
  get producers() { return producers; },
  get consumers() { return consumers; }
};

