# LAN CCTV - Video Monitoring System

A real-time video surveillance system for local networks using WebRTC and mediasoup. Transform any device with a camera into a security feed and monitor all streams from a central dashboard.

![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![License](https://img.shields.io/badge/License-MIT-blue)

## Features

- **Multi-Device Streaming**: Connect phones, laptops, or any device with a camera
- **Master Dashboard**: View all camera feeds in a grid layout
- **Single Stream View**: Click any tile to expand and view in full screen
- **Remote Camera Control**: Pan and zoom cameras from the master dashboard
- **High Quality Video**: Up to 1080p streaming with configurable quality
- **Server-Side Recording**: All streams are automatically recorded to the server
- **No Authentication Required**: Simple setup for home/office use
- **LAN Only**: No internet required, all traffic stays on your local network

## Architecture

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│  Phone Camera   │      │  Laptop Camera  │      │   Device N      │
└────────┬────────┘      └────────┬────────┘      └────────┬────────┘
         │                        │                        │
         │         WebRTC         │         WebRTC         │
         └────────────────────────┼────────────────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │       Node.js Server      │
                    │  ┌─────────────────────┐  │
                    │  │    Mediasoup SFU    │  │
                    │  └─────────────────────┘  │
                    │  ┌─────────────────────┐  │
                    │  │   FFmpeg Recorder   │  │
                    │  └─────────────────────┘  │
                    └─────────────┬─────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │     Master Dashboard      │
                    │     (View All Streams)    │
                    └───────────────────────────┘
```

## Prerequisites

- **Node.js** 18 or higher
- **FFmpeg** (for recording support)
- Devices must be on the same local network

### Installing FFmpeg

**macOS:**
```bash
brew install ffmpeg
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install ffmpeg
```

**Windows:**
Download from [ffmpeg.org](https://ffmpeg.org/download.html) and add to PATH.

## Installation

1. **Clone or download the project**

2. **Install dependencies:**
```bash
cd lan-cctv
npm install
```

3. **Start the server:**
```bash
npm start
```

4. **Access the application:**
   - The server will display the URL on startup
   - Open the URL on any device on your network
   - Example: `http://192.168.1.100:3000`

## Usage

### As a Streaming Device (Camera)

1. Open the server URL on your phone or laptop
2. Click **"Stream Device"**
3. Enter a name for your camera (e.g., "Front Door", "Living Room")
4. Select the camera and quality settings
5. Click **"Start Streaming"**
6. Keep the browser tab open while streaming

### As the Master Dashboard (Monitor)

1. Open the server URL on your monitoring device
2. Click **"Master Dashboard"**
3. All active camera streams will appear in a grid
4. Click any stream to expand to full view
5. Use pan/zoom controls to adjust the camera view
6. Click **"Recordings"** to view/download saved videos

## Camera Controls

From the expanded single-stream view, you can:

- **Zoom**: Use the slider to zoom in (1x to 5x)
- **Pan**: Use the directional buttons to pan the view
- **Reset**: Click the center button to reset to default

Note: Pan/zoom uses optical controls if supported by the device camera, otherwise digital zoom is applied.

## Recordings

- All video streams are automatically recorded to `server/recordings/`
- Files are saved as MP4 with the format: `{device-name}_{timestamp}.mp4`
- Access recordings from the Master Dashboard by clicking "Recordings"
- You can also browse directly to `http://{server-ip}:3000/recordings/`

## Configuration

Edit `server/config.js` to customize:

```javascript
module.exports = {
  server: {
    port: 3000,        // Server port
    host: '0.0.0.0'    // Listen on all interfaces
  },
  
  mediasoup: {
    worker: {
      rtcMinPort: 10000,  // WebRTC port range start
      rtcMaxPort: 10100   // WebRTC port range end
    },
    webRtcTransport: {
      initialAvailableOutgoingBitrate: 10000000,  // 10 Mbps
      maxIncomingBitrate: 10000000                // 10 Mbps
    }
  },
  
  recording: {
    directory: './server/recordings',
    format: 'mp4'
  }
};
```

## Troubleshooting

### Camera not working (Secure Context Error)

Modern browsers require HTTPS or localhost for camera access. When accessing via LAN IP over HTTP, you'll see a "Camera Access Blocked" error. Here are the solutions:

**Chrome (Recommended):**
1. Open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
2. Add your server URL (e.g., `http://192.168.1.100:3000`)
3. Enable the flag and restart Chrome

**Firefox:**
1. Open `about:config`
2. Search for `media.devices.insecure.enabled`
3. Set it to `true`

**Safari:**
- Safari is more restrictive; consider using Chrome or Firefox on the streaming device

**Alternative - Use localhost:**
- If streaming from the same machine as the server, use `http://localhost:3000`

### Connection issues

- Verify all devices are on the same network
- Check firewall settings (ports 3000 and 10000-10100)
- Restart the server if mediasoup worker crashes

### Recording not working

- Ensure FFmpeg is installed and in PATH
- Check the `server/recordings` directory exists and is writable
- View server console for FFmpeg error messages

### High latency

- Reduce video quality in streaming device settings
- Use wired connections where possible
- Limit the number of simultaneous streams

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Landing page |
| `GET /master.html` | Master dashboard |
| `GET /device.html` | Streaming device page |
| `GET /api/info` | Server information (IP addresses) |
| `GET /api/recordings` | List of recorded videos |
| `GET /recordings/{file}` | Download/stream a recording |

## Technology Stack

- **Backend**: Node.js, Express, WebSocket (ws)
- **Media Server**: mediasoup (SFU)
- **Recording**: FFmpeg via RTP pipe
- **Frontend**: Vanilla HTML, CSS, JavaScript
- **WebRTC**: mediasoup-client

## Security Notice

This application has **no authentication** and is designed for trusted local networks only. Do not expose to the public internet without adding proper security measures.

## License

MIT License - Feel free to use and modify for your needs.

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

