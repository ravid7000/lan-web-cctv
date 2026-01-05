const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const config = require('./config');
const { initializeMediasoup } = require('./mediasoup');
const { initializeWebSocket } = require('./websocket');
const fs = require('fs');

const app = express();

// Create HTTP or HTTPS server based on configuration
let server;
if (config.server.https?.enabled) {
  const keyPath = path.resolve(__dirname, config.server.https.keyPath);
  const certPath = path.resolve(__dirname, config.server.https.certPath);
  
  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.error('❌ HTTPS enabled but certificates not found!');
    console.error(`   Key: ${keyPath}`);
    console.error(`   Cert: ${certPath}`);
    console.error('   Run: ./scripts/setup-https.sh or see HTTPS_SETUP.md');
    process.exit(1);
  }
  
  const options = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  };
  
  server = https.createServer(options, app);
  console.log('🔒 HTTPS enabled');
} else {
  server = http.createServer(app);
  console.log('⚠️  HTTP mode (HTTPS recommended for camera access)');
}

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

// API endpoint to delete a recording
app.delete('/api/recordings/:filename', (req, res) => {
  const recordingsDir = path.resolve(config.recording.directory);
  const filename = req.params.filename;
  
  // Security: prevent directory traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  
  const filePath = path.join(recordingsDir, filename);
  
  // Only allow deletion of video files
  if (!filename.match(/\.(mp4|webm|mkv)$/i)) {
    return res.status(400).json({ error: 'Invalid file type' });
  }
  
  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Recording not found' });
    }
    
    fs.unlinkSync(filePath);
    console.log(`Deleted recording: ${filename}`);
    res.json({ success: true, message: 'Recording deleted' });
  } catch (error) {
    console.error('Error deleting recording:', error);
    res.status(500).json({ error: error.message });
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
    server.listen(config.server.port, () => {
      console.log('\n========================================');
      console.log('  LAN CCTV Server Started');
      console.log('========================================\n');
      console.log(`Server running on port ${config.server.port}`);
      console.log('\nAccess URLs:');
      
      const localIPs = config.getLocalIPs();
      const protocol = config.server.https?.enabled ? 'https' : 'http';
      
      if (localIPs.length > 0) {
        localIPs.forEach(({ name, address }) => {
          console.log(`  ${name}: ${protocol}://${address}:${config.server.port}`);
        });
      } else {
        console.log(`  Local: ${protocol}://localhost:${config.server.port}`);
      }
      
      if (!config.server.https?.enabled) {
        console.log('\n💡 Tip: Enable HTTPS for camera access without browser warnings');
        console.log('   See HTTPS_SETUP.md for instructions');
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

