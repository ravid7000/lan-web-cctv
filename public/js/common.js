// Common utilities for WebRTC and WebSocket communication

class CCTVClient {
  constructor() {
    this.ws = null;
    this.clientId = null;
    this.rtpCapabilities = null;
    this.device = null;
    this.sendTransport = null;
    this.recvTransport = null;
    this.sendTransportPromise = null;
    this.recvTransportPromise = null;
    this.producers = new Map();
    this.consumers = new Map();
    this.messageHandlers = new Map();
    this.pendingConsumes = new Map();
    this.pendingTransports = new Map();
    this.pendingTransportConnects = new Map();
    this.pendingProduces = new Map();
    this.connected = false;
  }

  // Connect to WebSocket server
  async connect() {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;
      
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.connected = true;
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.connected = false;
        this.handleDisconnect();
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      };

      this.ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        await this.handleMessage(data);
        
        // Resolve connect promise when we receive welcome message
        if (data.type === 'welcome') {
          this.clientId = data.payload.clientId;
          this.rtpCapabilities = data.payload.rtpCapabilities;
          resolve();
        }
      };
    });
  }

  // Send message to server
  send(type, payload = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  // Handle incoming messages
  async handleMessage(data) {
    const { type, payload } = data;
    
    // Handle internal message types
    switch (type) {
      case 'consumed':
        await this.handleConsumed(payload);
        return;
      case 'transport-created':
        this.handleTransportCreated(payload);
        return;
      case 'transport-connected':
        this.handleTransportConnected(payload);
        return;
      case 'produced':
        this.handleProduced(payload);
        return;
    }
    
    // Call registered handlers for other message types
    const handler = this.messageHandlers.get(type);
    if (handler) {
      await handler(payload);
    }
  }

  // Register message handler
  on(type, handler) {
    this.messageHandlers.set(type, handler);
  }

  // Handle disconnect
  handleDisconnect() {
    // Override in subclass
  }

  // Load mediasoup-client device
  async loadDevice() {
    // mediasoup-client UMD build exposes mediasoupClient on window
    const mediasoupClient = window.mediasoupClient;
    
    if (!mediasoupClient) {
      throw new Error('mediasoup-client library not loaded. Check your internet connection.');
    }
    
    if (!mediasoupClient.Device) {
      throw new Error('mediasoup-client Device not found. Library may be corrupted.');
    }
    
    this.device = new mediasoupClient.Device();
    await this.device.load({ routerRtpCapabilities: this.rtpCapabilities });
    
    console.log('Mediasoup device loaded');
    return this.device;
  }

  // Create send transport
  async createSendTransport() {
    if (this.sendTransport) {
      return this.sendTransport;
    }

    // If already creating, return the existing promise
    if (this.sendTransportPromise) {
      return this.sendTransportPromise;
    }

    console.log('Creating send transport...');
    
    this.sendTransportPromise = new Promise((resolve, reject) => {
      const requestId = 'send-' + Date.now();
      
      // Set timeout for transport creation
      const timeout = setTimeout(() => {
        this.pendingTransports.delete(requestId);
        reject(new Error('Send transport creation timed out'));
      }, 10000);
      
      this.pendingTransports.set(requestId, { 
        direction: 'send', 
        resolve: (transport) => {
          clearTimeout(timeout);
          resolve(transport);
        }, 
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });
      
      this.send('create-transport', { direction: 'send' });
    });

    try {
      const transport = await this.sendTransportPromise;
      console.log('Send transport created:', transport.id);
      return transport;
    } catch (error) {
      this.sendTransportPromise = null;
      throw error;
    }
  }

  // Create receive transport
  async createRecvTransport() {
    if (this.recvTransport) {
      return this.recvTransport;
    }

    // If already creating, return the existing promise
    if (this.recvTransportPromise) {
      return this.recvTransportPromise;
    }

    console.log('Creating receive transport...');

    this.recvTransportPromise = new Promise((resolve, reject) => {
      const requestId = 'recv-' + Date.now();
      
      // Set timeout for transport creation
      const timeout = setTimeout(() => {
        this.pendingTransports.delete(requestId);
        reject(new Error('Receive transport creation timed out'));
      }, 10000);
      
      this.pendingTransports.set(requestId, { 
        direction: 'recv', 
        resolve: (transport) => {
          clearTimeout(timeout);
          resolve(transport);
        }, 
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });
      
      this.send('create-transport', { direction: 'recv' });
    });

    try {
      const transport = await this.recvTransportPromise;
      console.log('Receive transport created:', transport.id);
      return transport;
    } catch (error) {
      this.recvTransportPromise = null;
      throw error;
    }
  }

  // Handle transport created response
  handleTransportCreated(data) {
    const direction = data.direction;
    console.log('Transport created response:', direction, data.id);
    
    // Find matching pending request
    for (const [requestId, pending] of this.pendingTransports.entries()) {
      if (pending.direction === direction) {
        this.pendingTransports.delete(requestId);
        
        try {
          if (direction === 'send') {
            this.setupSendTransport(data, pending.resolve);
          } else {
            this.setupRecvTransport(data, pending.resolve);
          }
        } catch (error) {
          console.error('Error setting up transport:', error);
          pending.reject(error);
        }
        return;
      }
    }
    
    console.warn('No pending transport request found for direction:', direction);
  }

  setupSendTransport(data, resolve) {
    this.sendTransport = this.device.createSendTransport({
      id: data.id,
      iceParameters: data.iceParameters,
      iceCandidates: data.iceCandidates,
      dtlsParameters: data.dtlsParameters
    });

    this.sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
      const connectId = this.sendTransport.id;
      this.pendingTransportConnects.set(connectId, callback);
      
      this.send('connect-transport', {
        transportId: this.sendTransport.id,
        dtlsParameters
      });
    });

    this.sendTransport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
      const produceId = `${this.sendTransport.id}-${kind}`;
      this.pendingProduces.set(produceId, { callback, kind });
      
      this.send('produce', {
        transportId: this.sendTransport.id,
        kind,
        rtpParameters
      });
    });

    resolve(this.sendTransport);
  }

  setupRecvTransport(data, resolve) {
    this.recvTransport = this.device.createRecvTransport({
      id: data.id,
      iceParameters: data.iceParameters,
      iceCandidates: data.iceCandidates,
      dtlsParameters: data.dtlsParameters
    });

    this.recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
      const connectId = this.recvTransport.id;
      this.pendingTransportConnects.set(connectId, callback);
      
      this.send('connect-transport', {
        transportId: this.recvTransport.id,
        dtlsParameters
      });
    });

    resolve(this.recvTransport);
  }

  // Handle transport connected response
  handleTransportConnected(data) {
    const callback = this.pendingTransportConnects.get(data.transportId);
    if (callback) {
      this.pendingTransportConnects.delete(data.transportId);
      callback();
    }
  }

  // Handle produced response
  handleProduced(data) {
    // Find the pending produce by kind
    for (const [produceId, pending] of this.pendingProduces.entries()) {
      if (pending.kind === data.kind) {
        this.pendingProduces.delete(produceId);
        pending.callback({ id: data.id });
        return;
      }
    }
  }

  // Produce a track
  async produce(track) {
    // Ensure send transport exists
    if (!this.sendTransport) {
      console.log('No send transport, creating one...');
      const transport = await this.createSendTransport();
      if (!transport) {
        throw new Error('Failed to create send transport');
      }
    }

    if (!this.sendTransport) {
      throw new Error('Send transport is null after creation');
    }

    console.log(`Producing ${track.kind} track on transport ${this.sendTransport.id}...`);
    
    const producer = await this.sendTransport.produce({ track });
    this.producers.set(producer.id, producer);
    
    console.log(`Producing ${track.kind} track: ${producer.id}`);
    return producer;
  }

  // Consume a producer
  async consume(producerId) {
    // Ensure receive transport exists
    if (!this.recvTransport) {
      await this.createRecvTransport();
    }

    return new Promise((resolve, reject) => {
      // Store the resolve callback for this producer
      this.pendingConsumes.set(producerId, { resolve, reject });

      this.send('consume', {
        transportId: this.recvTransport.id,
        producerId,
        rtpCapabilities: this.device.rtpCapabilities
      });
    });
  }

  // Handle consumed response - called from message handler
  async handleConsumed(data) {
    const pending = this.pendingConsumes.get(data.producerId);
    if (!pending) {
      console.warn('Received consumed for unknown producer:', data.producerId);
      return;
    }

    try {
      const consumer = await this.recvTransport.consume({
        id: data.id,
        producerId: data.producerId,
        kind: data.kind,
        rtpParameters: data.rtpParameters
      });

      this.consumers.set(consumer.id, consumer);

      // Resume consumer
      this.send('resume-consumer', { consumerId: consumer.id });

      console.log(`Consuming ${data.kind} from producer ${data.producerId}`);
      
      this.pendingConsumes.delete(data.producerId);
      pending.resolve(consumer);
    } catch (error) {
      console.error('Error creating consumer:', error);
      this.pendingConsumes.delete(data.producerId);
      pending.reject(error);
    }
  }

  // Close all connections
  close() {
    for (const producer of this.producers.values()) {
      producer.close();
    }
    for (const consumer of this.consumers.values()) {
      consumer.close();
    }
    if (this.sendTransport) {
      this.sendTransport.close();
    }
    if (this.recvTransport) {
      this.recvTransport.close();
    }
    if (this.ws) {
      this.ws.close();
    }
  }
}

// Export for use in other scripts
window.CCTVClient = CCTVClient;

