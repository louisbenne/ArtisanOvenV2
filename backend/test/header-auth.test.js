'use strict';
// Bug 13: admin tokens were accepted from ?_token= (leaks into logs/history).
// Bug 16: a malformed token reached a uuid comparison in Postgres; on the socket
// path that error was unhandled and killed the server (one message = site down).
const { resetDb, startApp, loginAs } = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');   // socket.io's own transport dependency

let app, sql, owner;
before(async () => { sql = await resetDb(); app = await startApp(); owner = await loginAs(app, sql, 'owner'); });
after(() => app.close());

const token = () => owner.authorization.replace('Bearer ', '');

test('bug 13: a token in the query string is not accepted', async () => {
  const res = await app.api('GET', `/api/admin/orders?_token=${token()}`);
  assert.equal(res.status, 401);
});

test('the Authorization header works', async () => {
  assert.equal((await app.api('GET', '/api/admin/orders', undefined, owner)).status, 200);
});

test('bug 16: malformed tokens get 401/404 responses, never a server error', async () => {
  const bad = { authorization: 'Bearer not-a-uuid' };
  assert.equal((await app.api('GET', '/api/admin/orders', undefined, bad)).status, 401);
  assert.equal((await app.api('POST', '/api/parent/orders', {}, bad)).status, 401);
  assert.equal((await app.api('POST', '/api/admin/logout', {}, bad)).status, 401);
  assert.equal((await app.api('GET', '/api/orders/lookup?q=nobody@example.com&token=junk')).status, 404);
});

// Minimal Socket.IO (Engine.IO v4) handshake over a raw WebSocket: resolves with
// the namespace reply — '40/admin,{…}' = connected, '44/admin,{…}' = rejected.
function socketConnect(auth, query = '') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${app.base.replace('http', 'ws')}/socket.io/?EIO=4&transport=websocket${query}`);
    ws.on('message', raw => {
      const msg = String(raw);
      if (msg.startsWith('0')) ws.send(`40/admin,${JSON.stringify(auth)}`);
      else if (msg.startsWith('40/admin') || msg.startsWith('44/admin')) { ws.close(); resolve(msg.slice(0, 2)); }
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('socket timeout')), 5000);
  });
}

test('bug 16: a malformed socket token is rejected and the server stays up', async () => {
  assert.equal(await socketConnect({ token: 'not-a-uuid' }), '44');
  assert.equal(await socketConnect({ token: 12345 }), '44');
  assert.equal((await app.api('GET', '/health')).status, 200);
});

test('sockets: a valid token in the handshake connects; the same token in the URL does not', async () => {
  assert.equal(await socketConnect({ token: token() }), '40');
  assert.equal(await socketConnect({}, `&token=${token()}`), '44');
});
