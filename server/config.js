const os = require('os');

// Get local IP addresses
function getLocalIPs() {
  try {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          addresses.push({ name, address: iface.address });
        }
      }
    }
    
    return addresses;
  } catch (error) {
    console.warn('Could not get network interfaces:', error.message);
    return [];
  }
}

module.exports = {
  server: {
    port: 3000,
    host: '0.0.0.0',
    // HTTPS configuration (optional)
    // Set enabled: true and provide certificate paths to enable HTTPS
    https: {
      enabled: false,  // Disable HTTPS for now to match Python server behavior
      keyPath: './certs/key.pem',
      certPath: './certs/cert.pem'
    }
  },
  
  mediasoup: {
    // Worker settings
    worker: {
      rtcMinPort: 10000,
      rtcMaxPort: 10100,
      logLevel: 'warn',
      logTags: [
        'info',
        'ice',
        'dtls',
        'rtp',
        'srtp',
        'rtcp'
      ]
    },
    
    // Router settings
    router: {
      mediaCodecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2
        },
        {
          kind: 'video',
          mimeType: 'video/VP8',
          clockRate: 90000,
          parameters: {
            'x-google-start-bitrate': 1000
          }
        },
        {
          kind: 'video',
          mimeType: 'video/VP9',
          clockRate: 90000,
          parameters: {
            'profile-id': 2,
            'x-google-start-bitrate': 1000
          }
        },
        {
          kind: 'video',
          mimeType: 'video/H264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '4d0032',
            'level-asymmetry-allowed': 1,
            'x-google-start-bitrate': 1000
          }
        },
        {
          kind: 'video',
          mimeType: 'video/H264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '42e01f',
            'level-asymmetry-allowed': 1,
            'x-google-start-bitrate': 1000
          }
        }
      ]
    },
    
    // WebRTC transport settings
    webRtcTransport: {
    listenIps: [
      {
        ip: '0.0.0.0',
        announcedIp: null // Will be set dynamically based on connection
      }
    ],
      initialAvailableOutgoingBitrate: 10000000, // 10 Mbps
      maxIncomingBitrate: 10000000, // 10 Mbps
      enableUdp: true,
      enableTcp: true,
      preferUdp: true
    },
    
    // Plain RTP transport for recording
    plainRtpTransport: {
      listenIp: { ip: '127.0.0.1', announcedIp: null },
      rtcpMux: false,
      comedia: false
    }
  },
  
  recording: {
    directory: './server/recordings',
    format: 'mp4'
  },
  
  getLocalIPs
};

