const { PeerServer } = require('peer');
const server = PeerServer({ host: '0.0.0.0', port: Number(process.env.PORT || 9000),
    path: '/eduguard', proxied: process.env.TRUST_PROXY === 'true',
    allow_discovery: false });
server.on('error', error => console.error('Signaling error:', error.message));
