#!/bin/bash
set -e

echo "🔐 Setting up HTTPS for LAN CCTV..."
echo ""

# Check if mkcert is installed
if ! command -v mkcert &> /dev/null; then
    echo "❌ mkcert not found!"
    echo ""
    echo "Install mkcert first:"
    echo "  macOS:   brew install mkcert"
    echo "  Linux:   See https://github.com/FiloSottile/mkcert#linux"
    echo "  Windows: choco install mkcert"
    echo ""
    exit 1
fi

# Install CA if not already installed
echo "📜 Installing local Certificate Authority..."
mkcert -install 2>/dev/null || echo "   CA already installed ✓"
echo ""

# Get local IPs
echo "🌐 Detecting local IP addresses..."
IPS=$(ifconfig 2>/dev/null | grep -Eo 'inet (addr:)?([0-9]*\.){3}[0-9]*' | grep -Eo '([0-9]*\.){3}[0-9]*' | grep -v '127.0.0.1' | head -5)

if [ -z "$IPS" ]; then
    # Try alternative method for Linux
    IPS=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "")
fi

IP_LIST="localhost 127.0.0.1 ::1"
for ip in $IPS; do
    if [ ! -z "$ip" ]; then
        IP_LIST="$IP_LIST $ip"
        echo "   Found: $ip"
    fi
done

echo ""
echo "📝 Generating certificate for:"
echo "   $IP_LIST"
echo ""

# Create certs directory
mkdir -p server/certs

# Generate certificate
mkcert -key-file server/certs/key.pem -cert-file server/certs/cert.pem $IP_LIST

echo ""
echo "✅ Certificate generated successfully!"
echo ""
echo "📋 Next steps:"
echo "   1. Edit server/config.js and set:"
echo "      https: { enabled: true }"
echo ""
echo "   2. Restart the server:"
echo "      npm start"
echo ""
echo "   3. Access via HTTPS:"
for ip in $IPS; do
    if [ ! -z "$ip" ]; then
        echo "      https://$ip:3000"
    fi
done
echo "      https://localhost:3000"
echo ""
echo "💡 To trust on other devices:"
echo "   Share the CA certificate:"
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "   ~/Library/Application Support/mkcert/rootCA.pem"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "   ~/.local/share/mkcert/rootCA.pem"
else
    echo "   Check mkcert documentation for your OS"
fi
echo ""

