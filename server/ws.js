const { WebSocketServer } = require('ws');

let wss;

function setupWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'connected', message: 'RT-DETR Pipeline WebSocket Connected' }));
  });
}

function broadcast(data) {
  if (!wss) return;
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(msg);
    }
  });
}

module.exports = { setupWebSocket, broadcast };
