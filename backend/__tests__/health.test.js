// Guards Improvement 6, Section 6's explicit requirement: the public
// /api/health keepalive check (used by Render's uptime monitor) must stay
// untouched — fast, dependency-free, no DB/aggregate query — even though this
// improvement adds a separate, heavier, admin-authenticated diagnostics
// endpoint alongside it. No mocks: boots the real app (schema/route
// definitions only — no DB connection is required to do that) on an
// ephemeral port and makes a real HTTP request, the same way Render's
// monitor would.

const http = require('http');
const app = require('../app');

const get = (path, port) => new Promise((resolve, reject) => {
  http.get(`http://127.0.0.1:${port}${path}`, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
  }).on('error', reject);
});

let server;
let port;

beforeAll((done) => {
  server = app.listen(0, () => { port = server.address().port; done(); });
});

afterAll((done) => { server.close(() => done()); });

test('GET /api/health responds 200 with the exact existing keepalive shape', async () => {
  const { status, body } = await get('/api/health', port);
  expect(status).toBe(200);
  expect(body).toEqual({ status: 'up', message: 'running' });
});

test('/api/health responds quickly and without requiring a database connection', async () => {
  const start = Date.now();
  const { status } = await get('/api/health', port);
  expect(status).toBe(200);
  expect(Date.now() - start).toBeLessThan(1000); // no aggregate/DB round trip hiding in this route
});
