'use strict';
// Minimal HTTP service. Exposes GET /hello. The WorkHorse smoke test adds GET /health.
const http = require('http');

function handle(req, res) {
  if (req.method === 'GET' && req.url === '/hello') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'hello' }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
}

function createServer() {
  return http.createServer(handle);
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, () => console.log(`listening on ${port}`));
}

module.exports = { createServer, handle };
