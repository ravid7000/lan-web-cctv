// Device streaming page logic

class DeviceStreamer extends CCTVClient {
  constructor() {
    super();
    this.localStream = null;
    this.videoTrack = null;
    this.audioTrack = null;
    this.isStreaming = false;
    this.currentZoom = 1;
    this.currentPan = { x: 0, y: 0 };
    this.zoomCapabilities = null;
  }

  async init() {
    // Check for secure context (required for camera access)
    if (!this.checkMediaDevicesSupport()) {
      return;
    }

    // Set default device name
    const defaultName = `Camera-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    document.getElementById('deviceName').value = defaultName;

    // Populate camera list
    await this.populateCameras();

    // Setup event handlers
    this.setupEventHandlers();
    
    // Connect to server
    await this.connectToServer();
  }

  checkMediaDevicesSupport() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      // Show error overlay
      const overlay = document.getElementById('videoOverlay');
      overlay.style.display = 'flex';
      overlay.innerHTML = `
        <div class="secure-context-error">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 48px; height: 48px; margin-bottom: 16px; color: #ef4444;">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <h3 style="margin-bottom: 8px; color: #f0f0f5;">Camera Access Blocked</h3>
          <p style="color: #a0a0b0; margin-bottom: 16px; max-width: 400px;">
            Camera access requires a secure connection (HTTPS) or localhost. 
            You're currently on an insecure HTTP connection.
          </p>
          <div style="background: #1a1a2e; padding: 16px; border-radius: 8px; text-align: left;">
            <p style="color: #00d9ff; font-weight: 600; margin-bottom: 8px;">Solutions:</p>
            <ol style="color: #a0a0b0; padding-left: 20px; font-size: 0.9rem;">
              <li style="margin-bottom: 8px;">
                <strong>Chrome flag (easiest):</strong><br>
                <code style="font-size: 0.8rem;">chrome://flags/#unsafely-treat-insecure-origin-as-secure</code><br>
                Add this server's URL and restart Chrome
              </li>
              <li style="margin-bottom: 8px;">
                <strong>Firefox:</strong> Go to <code>about:config</code>, search for 
                <code>media.devices.insecure.enabled</code> and set to <code>true</code>
              </li>
              <li>
                <strong>Access via localhost:</strong> If on the same machine, use 
                <code>http://localhost:3000</code>
              </li>
            </ol>
          </div>
        </div>
      `;
      
      // Disable start button
      document.getElementById('startBtn').disabled = true;
      document.getElementById('cameraSelect').innerHTML = '<option>Camera unavailable</option>';
      
      this.updateStatus('error', 'Insecure context');
      return false;
    }
    return true;
  }

  async populateCameras() {
    try {
      if (!navigator.mediaDevices) {
        return;
      }
      
      // Request permission first to get device labels
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        stream.getTracks().forEach(track => track.stop());
      } catch (e) {
        console.log('Initial permission request:', e.message);
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      
      const select = document.getElementById('cameraSelect');
      select.innerHTML = '';
      
      if (videoDevices.length === 0) {
        select.innerHTML = '<option value="">No cameras found</option>';
        return;
      }
      
      videoDevices.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Camera ${index + 1}`;
        select.appendChild(option);
      });
    } catch (error) {
      console.error('Error enumerating devices:', error);
      document.getElementById('cameraSelect').innerHTML = '<option value="">Error loading cameras</option>';
    }
  }

  setupEventHandlers() {
    document.getElementById('startBtn').addEventListener('click', () => this.startStreaming());
    document.getElementById('stopBtn').addEventListener('click', () => this.stopStreaming());
    document.getElementById('cameraSelect').addEventListener('change', () => this.switchCamera());
    document.getElementById('qualitySelect').addEventListener('change', () => this.updateQuality());
  }

  async connectToServer() {
    try {
      this.updateStatus('connecting', 'Connecting...');
      await this.connect();
      
      // Setup message handlers
      this.on('error', (data) => {
        console.error('Server error:', data.message);
        this.updateStatus('error', 'Error: ' + data.message);
      });

      this.on('pan-zoom-command', (data) => {
        this.handlePanZoomCommand(data);
      });

      this.updateStatus('connected', 'Connected');
    } catch (error) {
      console.error('Connection failed:', error);
      this.updateStatus('error', 'Connection failed');
    }
  }

  // Register as streamer and wait for confirmation
  registerAsStreamer(deviceName) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Registration timed out'));
      }, 10000);

      this.on('registered', (data) => {
        clearTimeout(timeout);
        console.log('Registered as streamer:', data);
        this.updateStatus('connected', 'Registered');
        resolve(data);
      });

      this.send('register', { role: 'streamer', deviceName });
    });
  }

  updateStatus(status, text) {
    const statusEl = document.getElementById('connectionStatus');
    statusEl.className = 'connection-status ' + status;
    statusEl.querySelector('.status-text').textContent = text;
  }

  async startStreaming() {
    try {
      document.getElementById('startBtn').disabled = true;
      this.updateStatus('connecting', 'Starting stream...');

      // Get media stream
      const quality = document.getElementById('qualitySelect').value;
      const audioEnabled = document.getElementById('audioEnabled').checked;
      const cameraId = document.getElementById('cameraSelect').value;

      const constraints = this.getConstraints(quality, cameraId, audioEnabled);
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);

      // Show preview
      const videoEl = document.getElementById('localVideo');
      videoEl.srcObject = this.localStream;
      document.getElementById('videoOverlay').style.display = 'none';

      // Get track capabilities
      this.videoTrack = this.localStream.getVideoTracks()[0];
      this.audioTrack = this.localStream.getAudioTracks()[0];

      if (this.videoTrack) {
        const capabilities = this.videoTrack.getCapabilities();
        this.zoomCapabilities = capabilities.zoom || null;
        
        // Update video stats
        const settings = this.videoTrack.getSettings();
        document.getElementById('resolution').textContent = `${settings.width}x${settings.height}`;
        document.getElementById('fps').textContent = `${settings.frameRate || 30} fps`;
      }

      // Load mediasoup device
      await this.loadDevice();

      // Register as streamer and wait for confirmation
      const deviceName = document.getElementById('deviceName').value;
      await this.registerAsStreamer(deviceName);

      // Create transport and produce tracks
      console.log('Creating send transport for streaming...');
      await this.createSendTransport();
      console.log('Send transport created successfully');

      // Produce video
      if (this.videoTrack) {
        await this.produce(this.videoTrack);
      }

      // Produce audio
      if (this.audioTrack) {
        await this.produce(this.audioTrack);
      }

      this.isStreaming = true;
      document.getElementById('startBtn').disabled = true;
      document.getElementById('stopBtn').disabled = false;
      document.getElementById('zoomControls').style.display = 'block';
      this.updateStatus('streaming', 'Streaming');

    } catch (error) {
      console.error('Failed to start streaming:', error);
      this.updateStatus('error', 'Failed: ' + error.message);
      document.getElementById('startBtn').disabled = false;
    }
  }

  getConstraints(quality, cameraId, audioEnabled) {
    const qualitySettings = {
      high: { width: 1920, height: 1080, frameRate: 30 },
      medium: { width: 1280, height: 720, frameRate: 30 },
      low: { width: 854, height: 480, frameRate: 24 }
    };

    const settings = qualitySettings[quality] || qualitySettings.high;

    return {
      video: {
        deviceId: cameraId ? { exact: cameraId } : undefined,
        width: { ideal: settings.width },
        height: { ideal: settings.height },
        frameRate: { ideal: settings.frameRate }
      },
      audio: audioEnabled
    };
  }

  async stopStreaming() {
    try {
      this.isStreaming = false;

      // IMPORTANT: Notify server FIRST before closing resources
      this.send('stop-streaming', {});
      console.log('Notified server of stream stop');

      // Stop local stream
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => track.stop());
        this.localStream = null;
      }

      // Close producers
      for (const producer of this.producers.values()) {
        try { producer.close(); } catch (e) {}
      }
      this.producers.clear();

      // Close transport
      if (this.sendTransport) {
        try { this.sendTransport.close(); } catch (e) {}
        this.sendTransport = null;
      }

      // Reset transport promise so new stream can create fresh transport
      this.sendTransportPromise = null;

      // Reset UI
      document.getElementById('localVideo').srcObject = null;
      document.getElementById('videoOverlay').style.display = 'flex';
      document.getElementById('startBtn').disabled = false;
      document.getElementById('stopBtn').disabled = true;
      document.getElementById('zoomControls').style.display = 'none';
      this.updateStatus('connected', 'Connected');

    } catch (error) {
      console.error('Error stopping stream:', error);
    }
  }

  async switchCamera() {
    if (!this.isStreaming) return;

    const cameraId = document.getElementById('cameraSelect').value;
    const quality = document.getElementById('qualitySelect').value;
    const audioEnabled = document.getElementById('audioEnabled').checked;

    try {
      // Get new stream
      const constraints = this.getConstraints(quality, cameraId, audioEnabled);
      const newStream = await navigator.mediaDevices.getUserMedia(constraints);

      // Replace video track
      const newVideoTrack = newStream.getVideoTracks()[0];
      if (newVideoTrack && this.videoTrack) {
        // Replace track in producer
        for (const producer of this.producers.values()) {
          if (producer.kind === 'video') {
            await producer.replaceTrack({ track: newVideoTrack });
          }
        }

        // Stop old track
        this.videoTrack.stop();
        this.videoTrack = newVideoTrack;
      }

      // Update preview
      this.localStream = newStream;
      document.getElementById('localVideo').srcObject = newStream;

      // Update stats
      const settings = newVideoTrack.getSettings();
      document.getElementById('resolution').textContent = `${settings.width}x${settings.height}`;

    } catch (error) {
      console.error('Failed to switch camera:', error);
    }
  }

  async updateQuality() {
    if (!this.isStreaming) return;

    const quality = document.getElementById('qualitySelect').value;
    const qualitySettings = {
      high: { width: 1920, height: 1080 },
      medium: { width: 1280, height: 720 },
      low: { width: 854, height: 480 }
    };

    const settings = qualitySettings[quality];

    try {
      if (this.videoTrack) {
        await this.videoTrack.applyConstraints({
          width: { ideal: settings.width },
          height: { ideal: settings.height }
        });

        const newSettings = this.videoTrack.getSettings();
        document.getElementById('resolution').textContent = `${newSettings.width}x${newSettings.height}`;
      }
    } catch (error) {
      console.error('Failed to update quality:', error);
    }
  }

  handlePanZoomCommand(data) {
    const { zoom, panX, panY } = data;

    console.log('Received pan/zoom command:', data);

    // Try optical zoom first
    if (zoom !== undefined && this.videoTrack && this.zoomCapabilities) {
      const clampedZoom = Math.max(
        this.zoomCapabilities.min,
        Math.min(this.zoomCapabilities.max, zoom)
      );

      this.videoTrack.applyConstraints({
        advanced: [{ zoom: clampedZoom }]
      }).then(() => {
        this.currentZoom = clampedZoom;
        document.getElementById('zoomLevel').textContent = `${clampedZoom.toFixed(1)}x`;
      }).catch(error => {
        console.log('Optical zoom not supported, using digital zoom');
        this.applyDigitalZoom(zoom);
      });
    } else if (zoom !== undefined) {
      this.applyDigitalZoom(zoom);
    }

    // Handle pan (digital only for most devices)
    if (panX !== undefined || panY !== undefined) {
      this.currentPan.x = panX || 0;
      this.currentPan.y = panY || 0;
      this.applyDigitalPan();
    }
  }

  applyDigitalZoom(zoom) {
    const videoEl = document.getElementById('localVideo');
    this.currentZoom = Math.max(1, Math.min(5, zoom));
    videoEl.style.transform = `scale(${this.currentZoom}) translate(${-this.currentPan.x}%, ${-this.currentPan.y}%)`;
    document.getElementById('zoomLevel').textContent = `${this.currentZoom.toFixed(1)}x (digital)`;
  }

  applyDigitalPan() {
    const videoEl = document.getElementById('localVideo');
    videoEl.style.transform = `scale(${this.currentZoom}) translate(${-this.currentPan.x}%, ${-this.currentPan.y}%)`;
  }

  handleDisconnect() {
    this.updateStatus('disconnected', 'Disconnected');
    this.stopStreaming();
    
    // Try to reconnect
    setTimeout(() => {
      this.connectToServer();
    }, 3000);
  }
}

// Initialize on page load
const streamer = new DeviceStreamer();
document.addEventListener('DOMContentLoaded', () => {
  streamer.init();
});

