# HTTPS Setup for LAN CCTV

This guide covers different approaches to enable HTTPS on your LAN CCTV server, which is required for camera access without browser security warnings.

## Why HTTPS?

Modern browsers require HTTPS (or localhost) for:
- Camera/microphone access (`getUserMedia`)
- Secure WebSocket connections (WSS)
- Better security for local network traffic

## Approach Comparison

| Method | Pros | Cons | Best For |
|--------|------|------|----------|
| **mkcert** | ✅ Trusted by browsers<br>✅ Easy setup<br>✅ Works on all devices | Requires CA installation | **Development & LAN** ⭐ |
| **Self-signed** | ✅ No external tools<br>✅ Quick setup | ❌ Browser warnings<br>❌ Manual trust per device | Testing only |
| **Let's Encrypt** | ✅ Publicly trusted<br>✅ Free | ❌ Requires public domain<br>❌ DNS setup | Production with domain |
| **Reverse Proxy** | ✅ Handles SSL termination<br>✅ Can use any cert | ❌ Additional service | Advanced setups |

---

## Recommended: mkcert (Best for LAN)

### Step 1: Install mkcert

**macOS:**
```bash
brew install mkcert
brew install nss  # For Firefox support
```

**Linux:**
```bash
# Ubuntu/Debian
sudo apt install libnss3-tools
wget -O mkcert https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v1.4.4-linux-amd64
chmod +x mkcert
sudo mv mkcert /usr/local/bin/

# Or use snap
sudo snap install mkcert
```

**Windows:**
```powershell
# Using Chocolatey
choco install mkcert

# Or download from: https://github.com/FiloSottile/mkcert/releases
```

### Step 2: Install Local CA

```bash
mkcert -install
```

This creates a local Certificate Authority trusted by your system.

### Step 3: Generate Certificates

From the project root:

```bash
# Create certs directory
mkdir -p server/certs

# Generate certificate for localhost and LAN IPs
# Replace 192.168.1.100 with your server's LAN IP
mkcert -key-file server/certs/key.pem -cert-file server/certs/cert.pem \
  localhost 127.0.0.1 ::1 \
  192.168.1.100 192.168.1.101  # Add all your LAN IPs
```

**Tip:** To get your LAN IPs automatically:
```bash
# macOS/Linux
ipconfig getifaddr en0  # macOS
hostname -I | awk '{print $1}'  # Linux

# Then add them to the mkcert command
```

### Step 4: Update Server Configuration

Edit `server/config.js`:

```javascript
module.exports = {
  server: {
    port: 3000,
    host: '0.0.0.0',
    https: {
      enabled: true,
      keyPath: './server/certs/key.pem',
      certPath: './server/certs/cert.pem'
    }
  },
  // ... rest of config
};
```

### Step 5: Share CA Certificate with Other Devices

For other devices on your LAN to trust the certificate:

1. **Find the CA certificate:**
   ```bash
   # macOS
   cat ~/Library/Application\ Support/mkcert/rootCA.pem
   
   # Linux
   cat ~/.local/share/mkcert/rootCA.pem
   
   # Windows
   type %LOCALAPPDATA%\mkcert\rootCA.pem
   ```

2. **Install on other devices:**
   - **macOS:** Double-click the `.pem` file → System Keychain → Trust
   - **Windows:** Import to "Trusted Root Certification Authorities"
   - **Android:** Settings → Security → Install from storage
   - **iOS:** Email the cert to device → Install profile

---

## Alternative: Self-Signed Certificate

If you can't use mkcert, generate a self-signed certificate:

```bash
mkdir -p server/certs

# Generate private key
openssl genrsa -out server/certs/key.pem 2048

# Generate certificate (valid for 1 year)
openssl req -new -x509 -key server/certs/key.pem \
  -out server/certs/cert.pem -days 365 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=IP:127.0.0.1,IP:192.168.1.100,DNS:localhost"
```

**Note:** Browsers will show security warnings. Users must click "Advanced" → "Proceed to localhost" on each device.

---

## Using Let's Encrypt (For Public Domains)

If you have a public domain pointing to your server:

1. Install Certbot:
   ```bash
   sudo apt install certbot  # Linux
   brew install certbot      # macOS
   ```

2. Get certificate:
   ```bash
   sudo certbot certonly --standalone -d yourdomain.com
   ```

3. Update config:
   ```javascript
   https: {
     enabled: true,
     keyPath: '/etc/letsencrypt/live/yourdomain.com/privkey.pem',
     certPath: '/etc/letsencrypt/live/yourdomain.com/fullchain.pem'
   }
   ```

---

## Testing HTTPS

After setup, test with:

```bash
# Check certificate
openssl s_client -connect localhost:3000 -servername localhost

# Test from browser
https://localhost:3000
https://192.168.1.100:3000  # Your LAN IP
```

---

## Troubleshooting

### Certificate not trusted
- Ensure mkcert CA is installed: `mkcert -install`
- On other devices, install the root CA certificate
- Clear browser cache and restart browser

### "NET::ERR_CERT_AUTHORITY_INVALID"
- Certificate doesn't match the domain/IP
- Regenerate with correct IPs: `mkcert -key-file ... -cert-file ... localhost 192.168.1.100`

### WebSocket connection fails
- Ensure using `wss://` instead of `ws://` in client code
- Check firewall allows port 3000

### Mixed content warnings
- Ensure all resources (JS, CSS) are loaded over HTTPS
- Check browser console for HTTP resources

---

## Security Notes

- **mkcert certificates** are only trusted on devices with the CA installed
- **Self-signed certificates** should only be used for testing
- For production, use proper certificates (Let's Encrypt, commercial CA)
- Keep private keys secure and never commit them to git

---

## Quick Start Script

Create `scripts/setup-https.sh`:

```bash
#!/bin/bash
set -e

echo "🔐 Setting up HTTPS for LAN CCTV..."

# Check if mkcert is installed
if ! command -v mkcert &> /dev/null; then
    echo "❌ mkcert not found. Install it first:"
    echo "   macOS: brew install mkcert"
    echo "   Linux: See https://github.com/FiloSottile/mkcert"
    exit 1
fi

# Install CA
echo "📜 Installing local CA..."
mkcert -install

# Get local IPs
echo "🌐 Detecting local IP addresses..."
IPS=$(ifconfig | grep -Eo 'inet (addr:)?([0-9]*\.){3}[0-9]*' | grep -Eo '([0-9]*\.){3}[0-9]*' | grep -v '127.0.0.1' | head -3)
IP_LIST="localhost 127.0.0.1 ::1"
for ip in $IPS; do
    IP_LIST="$IP_LIST $ip"
done

echo "📝 Generating certificate for: $IP_LIST"

# Create certs directory
mkdir -p server/certs

# Generate certificate
mkcert -key-file server/certs/key.pem -cert-file server/certs/cert.pem $IP_LIST

echo "✅ Certificate generated at server/certs/"
echo ""
echo "📋 Next steps:"
echo "   1. Update server/config.js to enable HTTPS"
echo "   2. Restart the server"
echo "   3. Access via https://localhost:3000"
```

Make it executable:
```bash
chmod +x scripts/setup-https.sh
./scripts/setup-https.sh
```

