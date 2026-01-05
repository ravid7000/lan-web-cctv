// Build script to bundle mediasoup-client for browser
const esbuild = require('esbuild');
const path = require('path');

async function build() {
  try {
    await esbuild.build({
      entryPoints: ['./client-entry.js'],
      bundle: true,
      outfile: './public/js/mediasoup-client.bundle.js',
      format: 'iife',
      globalName: 'mediasoupClient',
      platform: 'browser',
      target: ['chrome80', 'firefox78', 'safari14'],
      minify: true,
      sourcemap: false
    });
    console.log('mediasoup-client bundled successfully!');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();

