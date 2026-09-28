'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createServer } = require('../src/server');

function request(server, path) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    require('http').get({ port, path }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    }).on('error', reject);
  });
}

test('GET /hello returns a greeting', async () => {
  const server = createServer().listen(0);
  try {
    const r = await request(server, '/hello');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body, { message: 'hello' });
  } finally {
    server.close();
  }
});

test('unknown route returns 404', async () => {
  const server = createServer().listen(0);
  try {
    const r = await request(server, '/nope');
    assert.strictEqual(r.status, 404);
  } finally {
    server.close();
  }
});
