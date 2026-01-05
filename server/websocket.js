const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const mediasoup = require('./mediasoup');
const recorder = require('./recorder');
const config = require('./config');

// Connected clients
const clients = new Map();
// Streamers (devices streaming video)
const streamers = new Map();
// Masters (devices viewing streams)
const masters = new Set();

function initializeWebSocket(server, router) {
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws, req) => {
    // Check Basic Auth for WebSocket connections
    if (config.server.auth?.enabled) {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Basic ')) {
        console.log('WebSocket connection rejected: No authentication');
        ws.close(1008, 'Authentication required');
        return;
      }

      // Decode credentials
      const base64Credentials = authHeader.split(' ')[1];
      const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
      const [username, password] = credentials.split(':');

      // Verify credentials
      if (username !== config.server.auth.username || password !== config.server.auth.password) {
        console.log('WebSocket connection rejected: Invalid credentials');
        ws.close(1008, 'Invalid credentials');
        return;
      }
    }

    const clientId = uuidv4();
    // Extract client IP for WebRTC transport configuration
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || 
                     req.socket.remoteAddress?.replace('::ffff:', '') ||
                     '127.0.0.1';
    clients.set(clientId, { ws, role: null, deviceName: null, clientIp });

    console.log(`Client connected: ${clientId}`);

    // Send client their ID and router capabilities
    send(ws, 'welcome', {
      clientId,
      rtpCapabilities: mediasoup.getRouterRtpCapabilities()
    });

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);
        await handleMessage(clientId, ws, data);
      } catch (error) {
        console.error('Error handling message:', error);
        send(ws, 'error', { message: error.message });
      }
    });

    ws.on('close', () => {
      handleDisconnect(clientId);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error for ${clientId}:`, error);
    });
  });

  console.log('WebSocket server initialized');
}

async function handleMessage(clientId, ws, data) {
  const { type, payload } = data;
  const client = clients.get(clientId);

  switch (type) {
    case 'register': {
      const { role, deviceName } = payload;
      client.role = role;
      client.deviceName = deviceName || `Device-${clientId.slice(0, 8)}`;

      if (role === 'streamer') {
        streamers.set(clientId, {
          deviceName: client.deviceName,
          producers: [],
          transports: []
        });
        console.log(`Streamer registered: ${client.deviceName}`);
        
        // Notify all masters about new streamer
        broadcastToMasters('streamer-joined', {
          clientId,
          deviceName: client.deviceName
        });
      } else if (role === 'master') {
        masters.add(clientId);
        console.log(`Master registered: ${client.deviceName}`);
        
        // Send current list of streamers to master
        const streamerList = Array.from(streamers.entries()).map(([id, s]) => ({
          clientId: id,
          deviceName: s.deviceName,
          producers: mediasoup.getProducersByClient(id)
        }));
        
        send(ws, 'streamer-list', { streamers: streamerList });
      }

      send(ws, 'registered', { role, deviceName: client.deviceName });
      break;
    }

    case 'create-transport': {
      const { direction } = payload; // 'send' or 'recv'
      // Use server's own IP for announced IP (clients connect to server, not each other)
      const transportOptions = await mediasoup.createWebRtcTransport(clientId);
      
      const streamer = streamers.get(clientId);
      if (streamer) {
        streamer.transports.push(transportOptions.id);
      }

      send(ws, 'transport-created', { direction, ...transportOptions });
      break;
    }

    case 'connect-transport': {
      const { transportId, dtlsParameters } = payload;
      await mediasoup.connectTransport(transportId, dtlsParameters);
      send(ws, 'transport-connected', { transportId });
      break;
    }

    case 'produce': {
      const { transportId, kind, rtpParameters } = payload;
      const result = await mediasoup.createProducer(
        transportId,
        kind,
        rtpParameters,
        clientId,
        client.deviceName
      );

      const streamer = streamers.get(clientId);
      if (streamer) {
        streamer.producers.push(result.id);
      }

      // Notify all masters about new producer
      broadcastToMasters('new-producer', {
        producerId: result.id,
        clientId,
        deviceName: client.deviceName,
        kind
      });

      // Start recording for video producers
      if (kind === 'video') {
        try {
          await recorder.startRecording(result.id, client.deviceName);
        } catch (error) {
          console.error('Failed to start recording:', error);
        }
      }

      send(ws, 'produced', { id: result.id, kind });
      break;
    }

    case 'consume': {
      const { transportId, producerId, rtpCapabilities } = payload;
      const result = await mediasoup.createConsumer(
        transportId,
        producerId,
        rtpCapabilities,
        clientId
      );

      send(ws, 'consumed', result);
      break;
    }

    case 'resume-consumer': {
      const { consumerId } = payload;
      await mediasoup.resumeConsumer(consumerId);
      send(ws, 'consumer-resumed', { consumerId });
      break;
    }

    case 'pan-zoom': {
      // Master sending pan/zoom command to a streamer
      const { targetClientId, zoom, panX, panY } = payload;
      const targetClient = clients.get(targetClientId);
      
      if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
        send(targetClient.ws, 'pan-zoom-command', { zoom, panX, panY });
        console.log(`Pan/zoom command sent to ${targetClientId}: zoom=${zoom}, panX=${panX}, panY=${panY}`);
      }
      break;
    }

    case 'get-streamers': {
      const streamerList = Array.from(streamers.entries()).map(([id, s]) => ({
        clientId: id,
        deviceName: s.deviceName,
        producers: mediasoup.getProducersByClient(id)
      }));
      
      send(ws, 'streamer-list', { streamers: streamerList });
      break;
    }

    case 'get-producers': {
      const allProducers = mediasoup.getProducers();
      send(ws, 'producer-list', { producers: allProducers });
      break;
    }

    case 'stop-streaming': {
      // Device explicitly stopped streaming (not disconnected)
      console.log(`Streamer stopped streaming: ${client.deviceName} (${clientId})`);
      
      // Stop any recordings for this client
      const producers = mediasoup.getProducersByClient(clientId);
      for (const producer of producers) {
        recorder.stopRecording(producer.id);
      }

      // Clean up mediasoup resources for this client
      mediasoup.cleanupClient(clientId);

      // Remove from streamers and notify masters
      if (streamers.has(clientId)) {
        broadcastToMasters('streamer-left', {
          clientId,
          deviceName: client.deviceName
        });
        streamers.delete(clientId);
      }

      // Reset client role so they can re-register
      client.role = null;

      send(ws, 'streaming-stopped', { success: true });
      break;
    }

    default:
      console.warn(`Unknown message type: ${type}`);
  }
}

function handleDisconnect(clientId) {
  const client = clients.get(clientId);
  
  if (client) {
    console.log(`Client disconnected: ${clientId} (${client.deviceName || 'unknown'})`);

    // Stop any recordings for this client
    const producers = mediasoup.getProducersByClient(clientId);
    for (const producer of producers) {
      recorder.stopRecording(producer.id);
    }

    // Clean up mediasoup resources
    mediasoup.cleanupClient(clientId);

    // Notify masters if streamer disconnected
    if (streamers.has(clientId)) {
      broadcastToMasters('streamer-left', {
        clientId,
        deviceName: client.deviceName
      });
      streamers.delete(clientId);
    }

    // Remove from masters set
    masters.delete(clientId);

    // Remove from clients
    clients.delete(clientId);
  }
}

function send(ws, type, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
  }
}

function broadcastToMasters(type, payload) {
  for (const masterId of masters) {
    const master = clients.get(masterId);
    if (master && master.ws.readyState === WebSocket.OPEN) {
      send(master.ws, type, payload);
    }
  }
}

function broadcast(type, payload, excludeClientId = null) {
  for (const [clientId, client] of clients.entries()) {
    if (clientId !== excludeClientId && client.ws.readyState === WebSocket.OPEN) {
      send(client.ws, type, payload);
    }
  }
}

module.exports = {
  initializeWebSocket,
  clients,
  streamers,
  masters,
  send,
  broadcastToMasters,
  broadcast
};

