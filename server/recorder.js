const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('./config');

// Active recordings
const recordings = new Map();

// Port counter for unique RTP ports
let nextRtpPort = 20000;

function getNextPort() {
  const port = nextRtpPort;
  nextRtpPort += 2;
  if (nextRtpPort > 30000) nextRtpPort = 20000;
  return port;
}

// Check if FFmpeg is available
let ffmpegAvailable = false;
try {
  execSync('ffmpeg -version', { stdio: 'ignore' });
  ffmpegAvailable = true;
  console.log('✓ FFmpeg found. Recording enabled.');
} catch (e) {
  console.warn('⚠️  FFmpeg not found. Recording will be disabled.');
}

// Helper to wait
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function startRecording(producerId, deviceName) {
  if (!ffmpegAvailable) {
    console.log(`Recording skipped for ${deviceName} - FFmpeg not available`);
    return null;
  }

  const recordingsDir = path.resolve(config.recording.directory);
  if (!fs.existsSync(recordingsDir)) {
    fs.mkdirSync(recordingsDir, { recursive: true });
  }

  try {
    const mediasoupModule = require('./mediasoup');
    
    const producerData = mediasoupModule.producers.get(producerId);
    if (!producerData) {
      console.log(`Recording skipped - producer ${producerId} not found`);
      return null;
    }

    const producer = producerData.producer;
    const router = mediasoupModule.router;

    // Get unique port for FFmpeg to listen on
    const rtpPort = getNextPort();
    const rtcpPort = rtpPort + 1;

    // Generate filename - use MKV which is more flexible than WebM
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeDeviceName = (deviceName || 'unknown').replace(/[^a-zA-Z0-9-_]/g, '_');
    const filename = `${safeDeviceName}_${timestamp}.mkv`;
    const filepath = path.join(recordingsDir, filename);

    // Step 1: Create PlainTransport with comedia mode
    // comedia: true means mediasoup will wait for the first RTP packet to determine where to send RTCP
    // But we want to send TO FFmpeg, so we use comedia: false and explicit connect
    const plainTransport = await router.createPlainTransport({
      listenIp: { ip: '127.0.0.1', announcedIp: null },
      rtcpMux: false, // Separate RTP and RTCP ports
      comedia: false
    });

    // Step 2: Create consumer BEFORE connecting (to get actual RTP params)
    const consumer = await plainTransport.consume({
      producerId: producer.id,
      rtpCapabilities: router.rtpCapabilities,
      paused: true // Start paused, resume after FFmpeg is ready
    });

    // Get the actual codec and SSRC from consumer
    const codec = consumer.rtpParameters.codecs[0];
    const codecName = codec.mimeType.split('/')[1].toUpperCase();
    const payloadType = codec.payloadType;
    const clockRate = codec.clockRate;
    const ssrc = consumer.rtpParameters.encodings[0].ssrc;

    console.log(`Recording ${deviceName}: codec=${codecName} pt=${payloadType} ssrc=${ssrc}`);

    // Step 3: Connect transport to FFmpeg's listening port
    await plainTransport.connect({
      ip: '127.0.0.1',
      port: rtpPort,
      rtcpPort: rtcpPort
    });

    // Step 4: Create SDP with actual consumer parameters
    const sdpContent = `v=0
o=- 0 0 IN IP4 127.0.0.1
s=MediaSoup Recording
c=IN IP4 127.0.0.1
t=0 0
m=video ${rtpPort} RTP/AVP ${payloadType}
a=rtpmap:${payloadType} ${codecName}/${clockRate}
a=ssrc:${ssrc} cname:mediasoup
a=recvonly
`;

    const sdpPath = path.join(recordingsDir, `${producerId}.sdp`);
    fs.writeFileSync(sdpPath, sdpContent);
    console.log(`SDP created at ${sdpPath}:\n${sdpContent}`);

    // Step 5: Start FFmpeg with timeout and retry logic
    const ffmpegArgs = [
      '-y', // Overwrite output
      '-protocol_whitelist', 'file,udp,rtp',
      '-fflags', '+genpts+discardcorrupt',
      '-analyzeduration', '2000000', // 2 seconds
      '-probesize', '2000000',
      '-i', sdpPath,
      '-c:v', 'copy', // Copy video codec (no transcode)
      '-f', 'matroska', // Matroska container (more flexible)
      filepath
    ];

    console.log(`Starting FFmpeg: ffmpeg ${ffmpegArgs.join(' ')}`);

    const ffmpeg = spawn('ffmpeg', ffmpegArgs, { 
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let ffmpegOutput = '';
    let framesRecorded = 0;
    let ffmpegReady = false;

    ffmpeg.stderr.on('data', (data) => {
      const text = data.toString();
      ffmpegOutput += text;
      
      // Check for progress
      const frameMatch = text.match(/frame=\s*(\d+)/);
      if (frameMatch) {
        framesRecorded = parseInt(frameMatch[1]);
        if (!ffmpegReady) {
          ffmpegReady = true;
          console.log(`FFmpeg receiving frames for ${deviceName}`);
        }
      }
      
      // Log important messages
      if (text.includes('Stream mapping') || text.includes('Output #0')) {
        console.log(`FFmpeg ${deviceName}: ${text.trim()}`);
      }
    });

    ffmpeg.on('error', (error) => {
      console.error(`FFmpeg spawn error for ${deviceName}: ${error.message}`);
    });

    ffmpeg.on('close', (code) => {
      // Cleanup SDP file
      try { if (fs.existsSync(sdpPath)) fs.unlinkSync(sdpPath); } catch (e) {}
      
      if (framesRecorded > 0) {
        console.log(`✓ Recording saved: ${filename} (${framesRecorded} frames)`);
      } else if (code === 255 || code === null) {
        console.log(`Recording stopped: ${filename}`);
      } else {
        console.log(`Recording ended: ${filename} (exit: ${code})`);
        // Log last few error lines
        const lines = ffmpegOutput.split('\n').slice(-10);
        const errors = lines.filter(l => l.includes('Error') || l.includes('error') || l.includes('Invalid'));
        if (errors.length > 0) {
          console.error(`FFmpeg errors:\n${errors.join('\n')}`);
        }
      }
    });

    // Step 6: Wait for FFmpeg to start listening
    await sleep(1000);

    // Step 7: Resume consumer to start RTP flow
    await consumer.resume();
    console.log(`Consumer resumed, RTP flowing to FFmpeg on port ${rtpPort}`);

    // Store recording info
    recordings.set(producerId, {
      plainTransport,
      consumer,
      ffmpeg,
      filepath,
      sdpPath,
      deviceName,
      rtpPort,
      startTime: new Date()
    });

    console.log(`Recording started: ${filename}`);
    return { filepath, filename };

  } catch (error) {
    console.error(`Failed to start recording for ${deviceName}:`, error.message);
    return null;
  }
}

function stopRecording(producerId) {
  const recording = recordings.get(producerId);
  
  if (recording) {
    console.log(`Stopping recording for ${recording.deviceName}...`);

    // Close consumer first to stop RTP flow
    try { 
      if (recording.consumer && !recording.consumer.closed) {
        recording.consumer.close(); 
      }
    } catch (e) {}

    // Give FFmpeg a moment to flush
    setTimeout(() => {
      // Stop FFmpeg gracefully with 'q'
      if (recording.ffmpeg && !recording.ffmpeg.killed) {
        try { 
          recording.ffmpeg.stdin.write('q'); 
        } catch (e) {
          // If stdin write fails, kill it
          try { recording.ffmpeg.kill('SIGINT'); } catch (e2) {}
        }
        
        // Force kill after timeout
        setTimeout(() => {
          if (recording.ffmpeg && !recording.ffmpeg.killed) {
            try { recording.ffmpeg.kill('SIGKILL'); } catch (e) {}
          }
        }, 3000);
      }

      // Close transport
      try { 
        if (recording.plainTransport && !recording.plainTransport.closed) {
          recording.plainTransport.close(); 
        }
      } catch (e) {}

      // Cleanup SDP
      try { 
        if (recording.sdpPath && fs.existsSync(recording.sdpPath)) {
          fs.unlinkSync(recording.sdpPath); 
        }
      } catch (e) {}
    }, 500);

    recordings.delete(producerId);

    const duration = Math.round((new Date() - recording.startTime) / 1000);
    console.log(`Recording stopped: ${recording.deviceName} (${duration}s)`);

    return { filepath: recording.filepath, duration, deviceName: recording.deviceName };
  }
  return null;
}

function stopAllRecordings() {
  for (const producerId of recordings.keys()) {
    stopRecording(producerId);
  }
}

function getActiveRecordings() {
  return Array.from(recordings.entries()).map(([producerId, rec]) => ({
    producerId,
    deviceName: rec.deviceName,
    filepath: rec.filepath,
    startTime: rec.startTime,
    duration: new Date() - rec.startTime
  }));
}

function isRecordingEnabled() {
  return ffmpegAvailable;
}

process.on('exit', stopAllRecordings);
process.on('SIGINT', stopAllRecordings);
process.on('SIGTERM', stopAllRecordings);

module.exports = {
  startRecording,
  stopRecording,
  stopAllRecordings,
  getActiveRecordings,
  isRecordingEnabled,
  recordings
};
