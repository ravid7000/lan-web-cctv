// Entry point for bundling mediasoup-client
const mediasoupClient = require('mediasoup-client');

// Export to window for browser use
if (typeof window !== 'undefined') {
  window.mediasoupClient = mediasoupClient;
}

module.exports = mediasoupClient;

