# Quick HTTPS Setup Guide

## 🚀 Quick Start (Recommended: mkcert)

### 1. Install mkcert
```bash
# macOS
brew install mkcert

# Linux (Ubuntu/Debian)
sudo apt install libnss3-tools
# Download from: https://github.com/FiloSottile/mkcert/releases

# Windows
choco install mkcert
```

### 2. Run Setup Script
```bash
./scripts/setup-https.sh
```

This will:
- Install the local CA (if needed)
- Detect your LAN IP addresses
- Generate certificates for localhost and all LAN IPs
- Place them in `server/certs/`

### 3. Enable HTTPS in Config

Edit `server/config.js`:
```javascript
server: {
  port: 3000,
  host: '0.0.0.0',
  https: {
    enabled: true,  // Change to true
    keyPath: './server/certs/key.pem',
    certPath: './server/certs/cert.pem'
  }
}
```

### 4. Restart Server
```bash
npm start
```

### 5. Access via HTTPS
- `https://localhost:3000`
- `https://192.168.1.100:3000` (your LAN IP)

---

## 📱 Trust Certificate on Other Devices

For other devices on your LAN to trust the certificate (no browser warnings):

### Find CA Certificate Location:
```bash
# macOS
cat ~/Library/Application\ Support/mkcert/rootCA.pem

# Linux
cat ~/.local/share/mkcert/rootCA.pem

# Windows
type %LOCALAPPDATA%\mkcert\rootCA.pem
```

### Install on Devices:
- **macOS:** Double-click `.pem` → Keychain → Trust
- **Windows:** Import to "Trusted Root Certification Authorities"
- **Android:** Settings → Security → Install from storage
- **iOS:** Email cert → Install profile

---

## 🔧 Manual Setup (Alternative)

If you prefer manual setup or can't use mkcert:

### Generate Self-Signed Certificate:
```bash
mkdir -p server/certs

openssl genrsa -out server/certs/key.pem 2048

openssl req -new -x509 -key server/certs/key.pem \
  -out server/certs/cert.pem -days 365 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=IP:127.0.0.1,IP:192.168.1.100,DNS:localhost"
```

**Note:** Replace `192.168.1.100` with your actual LAN IP.

Then enable HTTPS in `server/config.js` as shown above.

---

## ✅ Verification

After setup, you should see:
- ✅ Server logs: `🔒 HTTPS enabled`
- ✅ Browser shows green lock icon
- ✅ No camera access warnings
- ✅ WebSocket connects via `wss://`

---

## 🐛 Troubleshooting

**"Certificates not found" error:**
- Run `./scripts/setup-https.sh` first
- Check files exist: `ls server/certs/`

**Browser shows "Not Secure":**
- Install mkcert CA: `mkcert -install`
- On other devices, install the root CA certificate

**WebSocket connection fails:**
- Ensure using `wss://` (automatic when HTTPS enabled)
- Check firewall allows port 3000

**Certificate doesn't match IP:**
- Regenerate with correct IPs in `setup-https.sh`
- Or manually: `mkcert -key-file ... -cert-file ... localhost 192.168.1.100`

---

## 📚 More Details

See `HTTPS_SETUP.md` for:
- Detailed comparison of approaches
- Let's Encrypt setup (for public domains)
- Advanced configurations
- Security considerations

