// Master dashboard logic

class MasterDashboard extends CCTVClient {
  constructor() {
    super();
    this.streamers = new Map();
    this.streamElements = new Map();
    this.expandedStreamerId = null;
    this.panPosition = { x: 0, y: 0 };
    this.zoomLevel = 1;
    this.isConnected = false;
  }

  async init() {
    // Show empty state immediately on load
    this.showEmptyState();
    this.updateStreamCount();
    
    // Setup UI event handlers
    this.setupEventHandlers();
    
    // Fetch server info
    await this.fetchServerInfo();
    
    // Connect to server
    await this.connectToServer();
  }

  async fetchServerInfo() {
    try {
      const response = await fetch('/api/info');
      const data = await response.json();
      
      if (data.localIPs && data.localIPs.length > 0) {
        const url = `http://${data.localIPs[0].address}:${data.port}`;
        document.getElementById('serverUrl').textContent = url;
      } else {
        document.getElementById('serverUrl').textContent = window.location.origin;
      }
    } catch (error) {
      document.getElementById('serverUrl').textContent = window.location.origin;
    }
  }

  setupEventHandlers() {
    // Recordings should always be accessible, even with zero streams
    const recordingsBtn = document.getElementById('recordingsBtn');
    if (recordingsBtn) {
      recordingsBtn.disabled = false;
      recordingsBtn.style.pointerEvents = 'auto';
      recordingsBtn.addEventListener('click', () => this.showRecordings());
    }
    document.getElementById('closeRecordingsBtn').addEventListener('click', () => this.hideRecordings());
    document.getElementById('closeExpandedBtn').addEventListener('click', () => this.closeExpandedView());

    document.getElementById('zoomSlider').addEventListener('input', (e) => {
      this.zoomLevel = parseFloat(e.target.value);
      document.getElementById('zoomValue').textContent = `${this.zoomLevel.toFixed(1)}x`;
      this.sendPanZoomCommand();
    });

    document.querySelectorAll('.pan-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const direction = e.target.dataset.direction;
        if (direction) this.handlePan(direction);
      });
    });

    document.getElementById('recordingsModal').addEventListener('click', (e) => {
      if (e.target.id === 'recordingsModal') this.hideRecordings();
    });
  }

  async connectToServer() {
    try {
      this.updateStatus('connecting', 'Connecting...');
      await this.connect();
      await this.loadDevice();

      // Register message handlers BEFORE registering
      this.setupMessageHandlers();

      // Register as master
      this.send('register', { role: 'master', deviceName: 'Master Dashboard' });

    } catch (error) {
      console.error('Connection failed:', error);
      this.updateStatus('error', 'Connection failed');
      // Retry after 5 seconds
      setTimeout(() => this.connectToServer(), 5000);
    }
  }

  setupMessageHandlers() {
    this.on('registered', (data) => {
      console.log('Registered as master');
      this.isConnected = true;
      this.updateStatus('connected', 'Connected');
    });

    this.on('streamer-list', (data) => {
      console.log('Received streamer list:', data.streamers?.length || 0, 'streamers');
      
      // Clear everything first
      this.clearAllStreamers();
      
      // Add all streamers from the list
      if (data.streamers && data.streamers.length > 0) {
        for (const streamer of data.streamers) {
          this.addStreamer(streamer);
        }
      }
      
      // Always update empty state after processing list
      this.showOrHideEmptyState();
    });

    this.on('streamer-joined', (data) => {
      console.log('Streamer joined:', data.deviceName);
      this.addStreamer(data);
      this.showOrHideEmptyState();
    });

    this.on('streamer-left', (data) => {
      console.log('Streamer left:', data.deviceName);
      this.removeStreamer(data.clientId);
      this.showOrHideEmptyState();
    });

    this.on('new-producer', async (data) => {
      console.log('New producer:', data.kind, 'from', data.deviceName);
      await this.consumeProducer(data);
    });

    this.on('error', (data) => {
      console.error('Server error:', data.message);
    });
  }

  updateStatus(status, text) {
    const statusEl = document.getElementById('connectionStatus');
    if (statusEl) {
      statusEl.className = 'connection-status ' + status;
      const textEl = statusEl.querySelector('.status-text');
      if (textEl) textEl.textContent = text;
    }
  }

  showEmptyState() {
    const emptyState = document.getElementById('emptyState');
    if (emptyState) emptyState.style.display = 'flex';
  }

  hideEmptyState() {
    const emptyState = document.getElementById('emptyState');
    if (emptyState) emptyState.style.display = 'none';
  }

  showOrHideEmptyState() {
    if (this.streamers.size === 0) {
      this.showEmptyState();
    } else {
      this.hideEmptyState();
    }
  }

  addStreamer(streamer) {
    const { clientId, deviceName, producers } = streamer;

    if (this.streamers.has(clientId)) {
      console.log('Streamer already exists:', clientId);
      return;
    }

    console.log('Adding streamer:', deviceName, clientId);

    this.streamers.set(clientId, {
      deviceName: deviceName || 'Unknown Device',
      producers: producers || [],
      videoConsumer: null,
      audioConsumer: null
    });

    this.createVideoTile(clientId, deviceName || 'Unknown Device');
    this.updateStreamCount();

    // Consume existing producers
    if (producers && producers.length > 0) {
      for (const producer of producers) {
        this.consumeProducer({
          producerId: producer.id,
          clientId,
          deviceName,
          kind: producer.kind
        });
      }
    }
  }

  removeStreamer(clientId) {
    const streamer = this.streamers.get(clientId);
    if (!streamer) {
      console.log('Streamer not found for removal:', clientId);
      return;
    }

    console.log('Removing streamer:', streamer.deviceName, clientId);

    // Close consumers safely
    if (streamer.videoConsumer) {
      try { streamer.videoConsumer.close(); } catch (e) {}
    }
    if (streamer.audioConsumer) {
      try { streamer.audioConsumer.close(); } catch (e) {}
    }

    // Remove from maps
    this.streamers.delete(clientId);
    this.removeVideoTile(clientId);
    this.updateStreamCount();

    // Close expanded view if this was the expanded streamer
    if (this.expandedStreamerId === clientId) {
      this.closeExpandedView();
    }
  }

  createVideoTile(clientId, deviceName) {
    const grid = document.getElementById('videoGrid');
    if (!grid) return;

    // Remove existing tile if any
    const existingTile = document.getElementById(`tile-${clientId}`);
    if (existingTile) existingTile.remove();

    const tile = document.createElement('div');
    tile.className = 'video-tile';
    tile.id = `tile-${clientId}`;
    tile.dataset.clientId = clientId;

    tile.innerHTML = `
      <video autoplay playsinline muted></video>
      <div class="tile-overlay">
        <div class="tile-name">${this.escapeHtml(deviceName)}</div>
        <div class="tile-status">
          <span class="recording-indicator">● REC</span>
        </div>
      </div>
      <div class="tile-loading">
        <div class="spinner"></div>
        <span>Connecting...</span>
      </div>
    `;

    tile.addEventListener('click', () => this.expandStream(clientId));
    grid.appendChild(tile);
    this.streamElements.set(clientId, tile);
    
    // Hide empty state since we have a tile now
    this.hideEmptyState();
  }

  removeVideoTile(clientId) {
    const tile = this.streamElements.get(clientId);
    if (tile) {
      tile.remove();
      this.streamElements.delete(clientId);
    }
    // Also try by ID in case it wasn't in the map
    const tileById = document.getElementById(`tile-${clientId}`);
    if (tileById) tileById.remove();
  }

  clearAllStreamers() {
    console.log('Clearing all streamers...');
    
    // Close all consumers
    for (const streamer of this.streamers.values()) {
      if (streamer.videoConsumer) {
        try { streamer.videoConsumer.close(); } catch (e) {}
      }
      if (streamer.audioConsumer) {
        try { streamer.audioConsumer.close(); } catch (e) {}
      }
    }
    
    // Remove all tiles
    for (const tile of this.streamElements.values()) {
      tile.remove();
    }
    
    // Clear maps
    this.streamers.clear();
    this.streamElements.clear();
    
    // Also clear any orphaned tiles
    const grid = document.getElementById('videoGrid');
    if (grid) {
      const tiles = grid.querySelectorAll('.video-tile');
      tiles.forEach(tile => tile.remove());
    }
    
    this.updateStreamCount();
  }

  async consumeProducer(data) {
    const { producerId, clientId, deviceName, kind } = data;

    try {
      if (!this.recvTransport) {
        await this.createRecvTransport();
      }

      const consumer = await this.consume(producerId);
      
      // Ensure streamer exists
      if (!this.streamers.has(clientId)) {
        this.addStreamer({ clientId, deviceName, producers: [] });
      }

      const streamer = this.streamers.get(clientId);
      if (!streamer) return;

      const tile = this.streamElements.get(clientId);

      if (kind === 'video') {
        streamer.videoConsumer = consumer;
        
        if (tile) {
          const videoEl = tile.querySelector('video');
          if (videoEl) {
            videoEl.srcObject = new MediaStream([consumer.track]);
            // Hide loading overlay
            const loading = tile.querySelector('.tile-loading');
            if (loading) loading.style.display = 'none';
          }
        }
      } else if (kind === 'audio') {
        streamer.audioConsumer = consumer;
        
        if (tile) {
          const videoEl = tile.querySelector('video');
          if (videoEl && videoEl.srcObject) {
            videoEl.srcObject.addTrack(consumer.track);
          }
        }
      }

    } catch (error) {
      console.error('Failed to consume producer:', error);
    }
  }

  expandStream(clientId) {
    const streamer = this.streamers.get(clientId);
    if (!streamer) return;

    this.expandedStreamerId = clientId;

    document.getElementById('videoGrid').style.display = 'none';
    document.getElementById('singleView').style.display = 'flex';

    document.getElementById('expandedDeviceName').textContent = streamer.deviceName || clientId;
    document.getElementById('expandedDeviceId').textContent = clientId.slice(0, 8);

    const expandedVideo = document.getElementById('expandedVideo');
    if (streamer.videoConsumer) {
      const stream = new MediaStream([streamer.videoConsumer.track]);
      if (streamer.audioConsumer) {
        stream.addTrack(streamer.audioConsumer.track);
      }
      expandedVideo.srcObject = stream;
      expandedVideo.muted = false;

      try {
        const settings = streamer.videoConsumer.track.getSettings();
        document.getElementById('expandedResolution').textContent = 
          `${settings.width || '?'}x${settings.height || '?'}`;
      } catch (e) {}
    }

    this.zoomLevel = 1;
    this.panPosition = { x: 0, y: 0 };
    document.getElementById('zoomSlider').value = 1;
    document.getElementById('zoomValue').textContent = '1.0x';
  }

  closeExpandedView() {
    this.expandedStreamerId = null;

    document.getElementById('videoGrid').style.display = 'grid';
    document.getElementById('singleView').style.display = 'none';

    const expandedVideo = document.getElementById('expandedVideo');
    if (expandedVideo) expandedVideo.srcObject = null;

    this.sendPanZoomCommand(true);
  }

  handlePan(direction) {
    const step = 10;
    switch (direction) {
      case 'up': this.panPosition.y = Math.max(-50, this.panPosition.y - step); break;
      case 'down': this.panPosition.y = Math.min(50, this.panPosition.y + step); break;
      case 'left': this.panPosition.x = Math.max(-50, this.panPosition.x - step); break;
      case 'right': this.panPosition.x = Math.min(50, this.panPosition.x + step); break;
      case 'reset': this.panPosition = { x: 0, y: 0 }; break;
    }
    this.sendPanZoomCommand();
  }

  sendPanZoomCommand(reset = false) {
    if (!this.expandedStreamerId) return;
    this.send('pan-zoom', {
      targetClientId: this.expandedStreamerId,
      ...(reset ? { zoom: 1, panX: 0, panY: 0 } : { zoom: this.zoomLevel, ...this.panPosition })
    });
  }

  updateStreamCount() {
    const el = document.getElementById('streamCount');
    if (el) el.textContent = this.streamers.size;
  }

  handleDisconnect() {
    console.log('Disconnected from server');
    this.isConnected = false;
    this.updateStatus('disconnected', 'Disconnected');
    // Keep recordings button usable even when disconnected/empty
    const recordingsBtn = document.getElementById('recordingsBtn');
    if (recordingsBtn) {
      recordingsBtn.disabled = false;
      recordingsBtn.style.pointerEvents = 'auto';
    }
    
    // Clear all streamers
    this.clearAllStreamers();
    this.showEmptyState();

    // Reconnect after delay
    setTimeout(() => {
      if (!this.isConnected) {
        console.log('Attempting to reconnect...');
        this.connectToServer();
      }
    }, 3000);
  }

  async showRecordings() {
    document.getElementById('recordingsModal').style.display = 'flex';
    
    try {
      const response = await fetch('/api/recordings');
      const data = await response.json();
      const list = document.getElementById('recordingsList');
      
      let statusHtml = '';
      if (data.enabled === false) {
        statusHtml = `<div class="recording-status warning">
          <strong>⚠️ Recording Disabled</strong>
          <p>FFmpeg is not installed. Install with: <code>brew install ffmpeg</code></p>
        </div>`;
      } else if (data.active?.length > 0) {
        statusHtml = `<div class="recording-status active">
          <strong>● Recording ${data.active.length} stream(s)</strong>
        </div>`;
      } else {
        statusHtml = `<div class="recording-status" style="background:rgba(16,185,129,0.1);border-color:rgba(16,185,129,0.3);color:#10b981;">
          <strong>✓ Recording Enabled</strong>
        </div>`;
      }
      
      if (!data.recordings?.length) {
        list.innerHTML = statusHtml + '<div class="empty-recordings">No recordings found</div>';
        return;
      }

      list.innerHTML = statusHtml + data.recordings.map(rec => `
        <div class="recording-item">
          <div class="recording-info">
            <div class="recording-name">${this.escapeHtml(rec.name)}</div>
            <div class="recording-meta">
              <span>${this.formatFileSize(rec.size)}</span>
              <span>${new Date(rec.modified).toLocaleString()}</span>
            </div>
          </div>
          <div class="recording-actions">
            <a href="/recordings/${encodeURIComponent(rec.name)}" class="btn btn-sm" target="_blank">Play</a>
            <a href="/recordings/${encodeURIComponent(rec.name)}" class="btn btn-sm" download>Download</a>
          </div>
        </div>
      `).join('');

    } catch (error) {
      console.error('Failed to load recordings:', error);
      document.getElementById('recordingsList').innerHTML = '<div class="error">Failed to load recordings</div>';
    }
  }

  hideRecordings() {
    document.getElementById('recordingsModal').style.display = 'none';
  }

  formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize
const dashboard = new MasterDashboard();
document.addEventListener('DOMContentLoaded', () => dashboard.init());
