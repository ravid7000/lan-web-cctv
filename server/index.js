const express = require('express');
const http = require('http');
const path = require('path');
const config = require('./config');
const { initializeMediasoup } = require('./mediasoup');
const { initializeWebSocket } = require('./websocket');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// API endpoint to get server info
app.get('/api/info', (req, res) => {
  const localIPs = config.getLocalIPs();
  res.json({
    serverTime: new Date().toISOString(),
    localIPs,
    port: config.server.port
  });
});

// API endpoint to list recordings
app.get('/api/recordings', (req, res) => {
  const recordingsDir = path.resolve(config.recording.directory);
  
  if (!fs.existsSync(recordingsDir)) {
    return res.json({ recordings: [], enabled: false });
  }
  
  try {
    const files = fs.readdirSync(recordingsDir)
      .filter(f => f.endsWith('.mp4') || f.endsWith('.webm') || f.endsWith('.mkv'))
      .map(f => {
        const filePath = path.join(recordingsDir, f);
        const stats = fs.statSync(filePath);
        return {
          name: f,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime
        };
      })
      .sort((a, b) => b.modified - a.modified);
    
    const recorder = require('./recorder');
    res.json({ 
      recordings: files,
      enabled: recorder.isRecordingEnabled(),
      active: recorder.getActiveRecordings()
    });
  } catch (error) {
    console.error('Error listing recordings:', error);
    res.json({ recordings: [], enabled: false, error: error.message });
  }
});

// Serve recordings
app.use('/recordings', express.static(path.join(__dirname, 'recordings')));

async function start() {
  try {
    // Ensure recordings directory exists
    const recordingsDir = config.recording.directory;
    if (!fs.existsSync(recordingsDir)) {
      fs.mkdirSync(recordingsDir, { recursive: true });
      console.log(`Created recordings directory: ${recordingsDir}`);
    }
    
    // Initialize mediasoup
    const { worker, router } = await initializeMediasoup();
    console.log('Mediasoup initialized');
    
    // Initialize WebSocket server
    initializeWebSocket(server, router);
    console.log('WebSocket server initialized');
    
    // Start HTTP server
    server.listen(config.server.port, config.server.host, () => {
      console.log('\n========================================');
      console.log('  LAN CCTV Server Started');
      console.log('========================================\n');
      console.log(`Server running on port ${config.server.port}`);
      console.log('\nAccess URLs:');
      
      const localIPs = config.getLocalIPs();
      if (localIPs.length > 0) {
        localIPs.forEach(({ name, address }) => {
          console.log(`  ${name}: http://${address}:${config.server.port}`);
        });
      } else {
        console.log(`  Local: http://localhost:${config.server.port}`);
      }
      
      console.log('\n----------------------------------------');
      console.log('  Share the URL with devices on your LAN');
      console.log('  to start streaming video feeds.');
      console.log('----------------------------------------\n');
    });
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\nShutting down server...');
      worker.close();
      server.close();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();

