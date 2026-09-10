'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createApp } = require('../server');

async function fixture(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otklik-test-'));
  const app = createApp({ dbFile: path.join(dir, 'test.db'), legacyDir: null, secureCookie: false, adminApiKey: 'test-admin-key', tokenEncryptionKey: 'test-token-key', logger: null, ...options });
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    app, base,
    async close() { await new Promise(resolve => server.close(resolve)); app.locals.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  };
}

async function json(base, pathname, { method = 'GET', body, cookie, admin = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  if (admin) headers.authorization = 'Bearer test-admin-key';
  const response = await fetch(base + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { response, data: await response.json() };
}

function cookieOf(response) { return response.headers.get('set-cookie').split(';')[0]; }

test('health endpoint and browser security headers are enabled', async t => {
  const fx = await fixture({ nodeEnv: 'production' }); t.after(() => fx.close());
  const response = await fetch(fx.base + '/healthz');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(response.headers.get('strict-transport-security'), /max-age=31536000/);
  assert.equal(response.headers.get('x-powered-by'), null);
  const ready = await fetch(fx.base + '/readyz');
  assert.equal(ready.status, 200);
});

test('registration stores a salted scrypt hash and creates a persistent session', async t => {
  const fx = await fixture(); t.after(() => fx.close());
  const result = await json(fx.base, '/api/register', { method: 'POST', body: { name: 'Иван', email: 'USER@example.com', password: 'long-password-123', accepted_terms: true } });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.user.email, 'user@example.com');
  assert.equal('password_hash' in result.data.user, false);
  assert.match(result.response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(result.response.headers.get('set-cookie'), /SameSite=Strict/);
  const stored = fx.app.locals.store.getUserByEmail('user@example.com');
  assert.match(stored.password_hash, /^scrypt\$/);
  assert.equal(stored.password_hash.includes('long-password-123'), false);
  const me = await json(fx.base, '/api/me', { cookie: cookieOf(result.response) });
  assert.equal(me.response.status, 200);
  assert.equal(me.data.user.id, stored.id);
});

test('legacy SHA-256 password is upgraded after a successful login', async t => {
  const fx = await fixture(); t.after(() => fx.close());
  const legacyHash = crypto.createHash('sha256').update('legacy-password').digest('hex');
  fx.app.locals.store.createUser({ id: 'legacy-user', name: 'Legacy', email: 'legacy@example.com', company: '', password_hash: legacyHash, created_at: new Date().toISOString(), tariff: 'none' });
  const result = await json(fx.base, '/api/login', { method: 'POST', body: { email: 'legacy@example.com', password: 'legacy-password' } });
  assert.equal(result.response.status, 200);
  assert.match(fx.app.locals.store.getUserById('legacy-user').password_hash, /^scrypt\$/);
});

test('plan limits are enforced and private OAuth fields never reach the client', async t => {
  const fx = await fixture(); t.after(() => fx.close());
  const registration = await json(fx.base, '/api/register', { method: 'POST', body: { name: 'Анна', email: 'anna@example.com', password: 'secure-password-123', accepted_terms: true } });
  const cookie = cookieOf(registration.response);
  const userId = registration.data.user.id;
  const blocked = await json(fx.base, '/api/email-accounts', { method: 'POST', cookie, body: { provider: 'gmail', email: 'sender@example.com' } });
  assert.equal(blocked.response.status, 403);
  const activated = await json(fx.base, '/api/admin/users/tariff', { method: 'PATCH', admin: true, body: { email: 'anna@example.com', tariff: 'start' } });
  assert.equal(activated.response.status, 200);
  const created = await json(fx.base, '/api/email-accounts', { method: 'POST', cookie, body: { provider: 'gmail', email: 'sender@example.com' } });
  assert.equal(created.response.status, 201);
  assert.equal('tokens_encrypted' in created.data.account, false);
  fx.app.locals.store.updateEmailAccount(created.data.account.id, userId, { tokens_encrypted: 'secret-ciphertext', token_expiry: Date.now() + 1000 });
  const listed = await json(fx.base, '/api/email-accounts', { cookie });
  assert.equal(listed.response.status, 200);
  assert.equal('tokens_encrypted' in listed.data.accounts[0], false);
  const second = await json(fx.base, '/api/email-accounts', { method: 'POST', cookie, body: { provider: 'gmail', email: 'second@example.com' } });
  assert.equal(second.response.status, 403);
  const excessive = await json(fx.base, `/api/email-accounts/${created.data.account.id}`, { method: 'PATCH', cookie, body: { daily_limit: 51 } });
  assert.equal(excessive.response.status, 400);
});

test('tariff request stores the selected plan and is rate limited', async t => {
  const fx = await fixture({ requestLimit: { windowMs: 60_000, max: 1 } }); t.after(() => fx.close());
  const first = await json(fx.base, '/api/requests', { method: 'POST', body: { email: 'lead@example.com', plan: 'growth', message: 'Хотим подключить команду из пяти человек.', accepted_privacy: true } });
  assert.equal(first.response.status, 201);
  const stored = fx.app.locals.store.listRequests('new', 10);
  assert.equal(stored[0].plan, 'growth');
  const handled = await json(fx.base, `/api/admin/requests/${first.data.id}`, { method: 'PATCH', admin: true, body: { status: 'done' } });
  assert.equal(handled.response.status, 200);
  assert.equal(handled.data.request.status, 'done');
  const second = await json(fx.base, '/api/requests', { method: 'POST', body: { email: 'lead@example.com', plan: 'growth', message: 'Повторная заявка с тем же адресом.', accepted_privacy: true } });
  assert.equal(second.response.status, 429);
  assert.ok(second.response.headers.get('retry-after'));
});
