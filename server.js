'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { OAuth2Client } = require('google-auth-library');
const { Store } = require('./store');

loadEnv(path.join(__dirname, '.env'));

const PLAN_LIMITS = Object.freeze({
  none: { maxAccounts: 0, maxDailyLimit: 0 },
  free: { maxAccounts: 0, maxDailyLimit: 0 },
  start: { maxAccounts: 1, maxDailyLimit: 50 },
  growth: { maxAccounts: 5, maxDailyLimit: 100 },
  pro: { maxAccounts: 5, maxDailyLimit: 100 },
  business: { maxAccounts: 20, maxDailyLimit: 500 }
});
const ACCOUNT_KEYS = ['id', 'provider', 'email', 'status', 'enabled', 'daily_limit', 'sent_today', 'queued_today', 'created_at', 'counter_date', 'updated_at', 'authorized_at'];
const USER_KEYS = ['id', 'name', 'email', 'company', 'created_at', 'tariff', 'email_verified'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_TTL = 24 * 60 * 60 * 1000;

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && process.env[match[1].trim()] === undefined) process.env[match[1].trim()] = match[2].trim();
  }
}

function createApp(options = {}) {
  const isProduction = (options.nodeEnv || process.env.NODE_ENV) === 'production';
  const tokenKey = options.tokenEncryptionKey ?? process.env.TOKEN_ENCRYPTION_KEY;
  const sealTokens = tokenKey ? createTokenSealer(tokenKey) : null;
  const dbFile = options.dbFile || process.env.OTKLIK_DB_PATH || path.join(__dirname, 'data', 'otklik.db');
  const legacyDir = options.legacyDir === undefined ? path.join(__dirname, 'database') : options.legacyDir;
  const store = options.store || new Store({ dbFile, legacyDir, sealTokens });
  const googleClient = options.googleClient || new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
  const app = express();
  const secureCookie = options.secureCookie ?? (isProduction || process.env.COOKIE_SECURE === '1');
  const adminKey = options.adminApiKey ?? process.env.ADMIN_API_KEY;
  const webhookUrl = options.requestWebhookUrl ?? process.env.REQUEST_WEBHOOK_URL;
  const logger = options.logger === undefined ? ((isProduction || process.env.LOG_REQUESTS === '1') ? console : null) : options.logger;

  app.disable('x-powered-by');
  if (options.trustProxy !== undefined) app.set('trust proxy', options.trustProxy);
  else if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  app.use(express.json({ limit: '16kb' }));
  app.use(securityHeaders(isProduction));
  app.use(requestLogger(logger));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
      if (req.headers.origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: 'Недопустимый источник запроса.' });
    }
    next();
  });

  const authLimit = rateLimit(options.loginLimit || { windowMs: 15 * 60 * 1000, max: 10 });
  const requestLimit = rateLimit(options.requestLimit || { windowMs: 60 * 60 * 1000, max: 5 });

  function rawSession(req) {
    const cookie = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('otklik_session='));
    return cookie ? decodeURIComponent(cookie.slice('otklik_session='.length)) : null;
  }
  function current(req) {
    const raw = rawSession(req);
    if (!raw) return null;
    const idHash = hash(raw);
    const session = store.getSession(idHash);
    if (!session || session.expires_at < Date.now()) {
      if (session) store.deleteSession(idHash);
      return null;
    }
    const user = store.getUserById(session.user_id);
    return user ? { user, idHash } : null;
  }
  function login(req, res, user) {
    const previous = rawSession(req);
    if (previous) store.deleteSession(hash(previous));
    store.cleanupExpired(Date.now());
    const raw = crypto.randomBytes(32).toString('base64url');
    store.createSession({ idHash: hash(raw), userId: user.id, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL });
    res.cookie('otklik_session', raw, { httpOnly: true, sameSite: 'strict', secure: secureCookie, maxAge: SESSION_TTL, path: '/', priority: 'high' });
    res.json({ ok: true, user: publicUser(user) });
  }
  function requireUser(req, res) {
    const session = current(req);
    if (!session) { res.status(401).json({ error: 'Сначала войдите в аккаунт.' }); return null; }
    return session;
  }
  function requireSubscription(req, res) {
    const session = requireUser(req, res);
    if (!session) return null;
    const plan = PLAN_LIMITS[session.user.tariff || 'none'];
    if (!plan || !plan.maxAccounts) { res.status(403).json({ error: 'Для подключения почты нужна активная подписка.', code: 'SUBSCRIPTION_REQUIRED' }); return null; }
    return session;
  }
  function requireAdmin(req, res, next) {
    if (!adminKey) return res.status(404).json({ error: 'Метод не найден.' });
    const supplied = req.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
    if (!safeEqual(supplied, adminKey)) return res.status(401).json({ error: 'Требуется ключ администратора.' });
    next();
  }

  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.get('/readyz', (req, res) => {
    try { res.json({ ok: store.healthcheck() }); }
    catch { res.status(503).json({ ok: false }); }
  });

  app.post('/api/register', authLimit, (req, res) => {
    const { name, email, password, company = '', accepted_terms: acceptedTerms } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 100 || !validEmail(email) || typeof password !== 'string' || password.length < 10 || password.length > 256 || typeof company !== 'string' || company.length > 200 || acceptedTerms !== true) {
      return res.status(400).json({ error: 'Проверьте имя, email и пароль (не менее 10 символов).' });
    }
    const normalized = email.trim().toLowerCase();
    if (store.getUserByEmail(normalized)) return res.status(409).json({ error: 'Этот email уже зарегистрирован.' });
    const user = store.createUser({ id: crypto.randomUUID(), name: name.trim(), email: normalized, company: company.trim(), password_hash: hashPassword(password), created_at: new Date().toISOString(), tariff: 'none', terms_accepted_at: new Date().toISOString(), terms_version: '2026-09-10' });
    login(req, res, user);
  });

  app.post('/api/login', authLimit, (req, res) => {
    const { email, password } = req.body || {};
    if (!validEmail(email) || typeof password !== 'string') return res.status(400).json({ error: 'Введите email и пароль.' });
    const user = store.getUserByEmail(email.trim().toLowerCase());
    if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: 'Неверный email или пароль.' });
    if (!user.password_hash.startsWith('scrypt$')) {
      user.password_hash = hashPassword(password);
      store.updatePasswordHash(user.id, user.password_hash);
    }
    login(req, res, user);
  });

  app.get('/api/me', (req, res) => { const session = current(req); if (!session) return res.status(401).json({ error: 'Войдите в аккаунт.' }); res.json({ user: publicUser(session.user) }); });
  app.post('/api/logout', (req, res) => { const raw = rawSession(req); if (raw) store.deleteSession(hash(raw)); clearCookie(res, secureCookie); res.json({ ok: true }); });
  app.post('/api/logout-all', (req, res) => { const session = requireUser(req, res); if (!session) return; store.deleteUserSessions(session.user.id); clearCookie(res, secureCookie); res.json({ ok: true }); });

  app.post('/api/account/password', authLimit, (req, res) => {
    const session = requireUser(req, res); if (!session) return;
    const { current_password: oldPassword, new_password: newPassword } = req.body || {};
    if (typeof oldPassword !== 'string' || !verifyPassword(oldPassword, session.user.password_hash)) return res.status(401).json({ error: 'Текущий пароль указан неверно.' });
    if (typeof newPassword !== 'string' || newPassword.length < 10 || newPassword.length > 256) return res.status(400).json({ error: 'Новый пароль должен содержать от 10 до 256 символов.' });
    store.updatePasswordHash(session.user.id, hashPassword(newPassword));
    store.deleteUserSessions(session.user.id, session.idHash);
    res.json({ ok: true });
  });

  app.delete('/api/account', authLimit, (req, res) => {
    const session = requireUser(req, res); if (!session) return;
    if (typeof req.body?.password !== 'string' || !verifyPassword(req.body.password, session.user.password_hash)) return res.status(401).json({ error: 'Пароль указан неверно.' });
    store.deleteUser(session.user.id); clearCookie(res, secureCookie); res.json({ ok: true });
  });

  app.get(['/api/users', '/api/users/:email'], (req, res) => res.status(403).json({ error: 'Список пользователей закрыт. Свой профиль доступен через /api/me.' }));

  app.get('/api/email-accounts', (req, res) => {
    const session = requireSubscription(req, res); if (!session) return;
    res.json({ accounts: store.listEmailAccounts(session.user.id).map(publicAccount) });
  });

  app.post('/api/email-accounts', (req, res) => {
    const session = requireSubscription(req, res); if (!session) return;
    const { provider, email } = req.body || {};
    if (!['gmail', 'outlook', 'other'].includes(provider) || !validEmail(email)) return res.status(400).json({ error: 'Выберите провайдера и укажите корректный email.' });
    const normalized = email.trim().toLowerCase();
    const accounts = store.listEmailAccounts(session.user.id);
    const plan = PLAN_LIMITS[session.user.tariff];
    if (accounts.length >= plan.maxAccounts) return res.status(403).json({ error: `На вашем тарифе можно подключить до ${plan.maxAccounts} почтовых ящиков.`, code: 'PLAN_ACCOUNT_LIMIT' });
    if (accounts.some(a => a.email === normalized)) return res.status(409).json({ error: 'Этот почтовый ящик уже добавлен.' });
    const account = store.createEmailAccount({ id: crypto.randomUUID(), user_id: session.user.id, provider, email: normalized, status: 'authorization_required', enabled: false, daily_limit: Math.min(25, plan.maxDailyLimit), sent_today: 0, queued_today: 0, created_at: new Date().toISOString(), counter_date: new Date().toISOString().slice(0, 10) });
    res.status(201).json({ account: publicAccount(account) });
  });

  app.patch('/api/email-accounts/:id', (req, res) => {
    const session = requireSubscription(req, res); if (!session) return;
    const account = store.getEmailAccount(req.params.id, session.user.id);
    if (!account) return res.status(404).json({ error: 'Почтовый ящик не найден.' });
    const { enabled, daily_limit: dailyLimit } = req.body || {};
    const changes = { updated_at: new Date().toISOString() };
    if (enabled !== undefined) {
      if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'Некорректное состояние ящика.' });
      if (enabled && account.status !== 'connected') return res.status(409).json({ error: 'Сначала завершите авторизацию у почтового провайдера.', code: 'AUTHORIZATION_REQUIRED' });
      changes.enabled = enabled;
    }
    if (dailyLimit !== undefined) {
      const max = PLAN_LIMITS[session.user.tariff].maxDailyLimit;
      if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > max) return res.status(400).json({ error: `Дневной лимит на вашем тарифе должен быть от 1 до ${max} писем.`, code: 'PLAN_DAILY_LIMIT' });
      changes.daily_limit = dailyLimit;
    }
    res.json({ account: publicAccount(store.updateEmailAccount(account.id, session.user.id, changes)) });
  });

  app.get('/api/email-accounts/:id/authorize', async (req, res, next) => {
    const session = requireSubscription(req, res); if (!session) return;
    const account = store.getEmailAccount(req.params.id, session.user.id);
    if (!account) return res.status(404).json({ error: 'Почтовый ящик не найден.' });
    if (account.provider !== 'gmail') return res.status(400).json({ error: 'Пока поддерживается только Gmail.' });
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) return res.status(503).json({ error: 'Авторизация Gmail ещё не настроена администратором.' });
    if (!sealTokens) return res.status(503).json({ error: 'Хранилище OAuth-токенов ещё не настроено администратором.' });
    try {
      store.cleanupExpired(Date.now());
      const state = crypto.randomBytes(32).toString('base64url');
      const { codeVerifier, codeChallenge } = await googleClient.generateCodeVerifierAsync();
      store.createOAuthState({ stateHash: hash(state), userId: session.user.id, accountId: account.id, codeVerifier, createdAt: Date.now(), expiresAt: Date.now() + 10 * 60 * 1000 });
      res.redirect(googleClient.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: ['https://www.googleapis.com/auth/gmail.send'], state, code_challenge_method: 'S256', code_challenge: codeChallenge }));
    } catch (error) { next(error); }
  });

  app.get('/api/email-accounts/callback/google', async (req, res) => {
    const { code, state } = req.query;
    if (typeof code !== 'string' || typeof state !== 'string') return res.status(400).send('Некорректный ответ провайдера.');
    const saved = store.consumeOAuthState(hash(state), Date.now());
    if (!saved) return res.status(400).send('Ссылка авторизации истекла или уже использована.');
    const account = store.getEmailAccount(saved.account_id, saved.user_id);
    if (!account || !sealTokens) return res.status(400).send('Не удалось завершить авторизацию.');
    try {
      const { tokens } = await googleClient.getToken({ code, codeVerifier: saved.code_verifier });
      const previous = account.tokens_encrypted ? sealTokens.open(account.tokens_encrypted) : {};
      store.updateEmailAccount(account.id, account.user_id, { status: 'connected', authorized_at: new Date().toISOString(), updated_at: new Date().toISOString(), tokens_encrypted: sealTokens({ access_token: tokens.access_token || previous.access_token || null, refresh_token: tokens.refresh_token || previous.refresh_token || null }), token_expiry: tokens.expiry_date || null });
      res.type('html').send('<!doctype html><html lang="ru"><meta charset="utf-8"><title>Почта подключена</title><body><h1>Почта подключена</h1><p>Вернитесь в Отклик и обновите страницу Email Accounts.</p></body></html>');
    } catch (error) {
      console.error('Google OAuth exchange failed:', error.message);
      res.status(502).send('Провайдер не завершил авторизацию. Попробуйте ещё раз.');
    }
  });

  app.post('/api/requests', requestLimit, (req, res) => {
    const { email, message, plan = null, accepted_privacy: acceptedPrivacy } = req.body || {};
    if (!validEmail(email) || typeof message !== 'string' || message.trim().length < 10 || message.length > 3000 || (plan !== null && !Object.hasOwn(PLAN_LIMITS, plan)) || acceptedPrivacy !== true) return res.status(400).json({ error: 'Укажите email, тариф, согласие и опишите задачу (10–3000 символов).' });
    if (store.countRequests() >= 10000) return res.status(503).json({ error: 'Приём заявок временно приостановлен.' });
    const item = store.createRequest({ id: crypto.randomUUID(), email: email.trim().toLowerCase(), message: message.trim(), plan, created_at: new Date().toISOString(), consent_at: new Date().toISOString() });
    res.status(201).json({ ok: true, id: item.id });
    if (webhookUrl) notifyWebhook(webhookUrl, item);
  });

  app.get('/api/admin/requests', requireAdmin, (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : 'new';
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    res.json({ requests: store.listRequests(status, limit) });
  });
  app.patch('/api/admin/requests/:id', requireAdmin, (req, res) => {
    if (!['new', 'in_progress', 'done', 'spam'].includes(req.body?.status)) return res.status(400).json({ error: 'Неизвестный статус заявки.' });
    const request = store.updateRequestStatus(req.params.id, req.body.status);
    if (!request) return res.status(404).json({ error: 'Заявка не найдена.' });
    res.json({ request });
  });
  app.patch('/api/admin/users/tariff', requireAdmin, (req, res) => {
    if (!validEmail(req.body?.email) || typeof req.body?.tariff !== 'string' || !Object.hasOwn(PLAN_LIMITS, req.body.tariff)) return res.status(400).json({ error: 'Укажите email и известный тариф.' });
    const currentUser = store.getUserByEmail(req.body.email.trim().toLowerCase());
    if (!currentUser) return res.status(404).json({ error: 'Пользователь не найден.' });
    res.json({ user: publicUser(store.updateTariff(currentUser.id, req.body.tariff)) });
  });
  app.patch('/api/admin/users/:id/tariff', requireAdmin, (req, res) => {
    if (typeof req.body?.tariff !== 'string' || !Object.hasOwn(PLAN_LIMITS, req.body.tariff)) return res.status(400).json({ error: 'Неизвестный тариф.' });
    const user = store.updateTariff(req.params.id, req.body.tariff);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден.' });
    res.json({ user: publicUser(user) });
  });

  app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProduction ? '1h' : 0, etag: true }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Метод не найден.' }));
  app.use((err, req, res, next) => { console.error(err.message); if (res.headersSent) return next(err); res.status(err.status || 500).json({ error: err.status === 400 ? 'Некорректный запрос.' : 'Не удалось обработать запрос. Попробуйте ещё раз.' }); });
  app.locals.store = store;
  app.locals.close = () => store.close();
  return app;
}

function securityHeaders(isProduction) {
  return (req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups', 'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY'
    });
    if (isProduction || req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

function requestLogger(logger) {
  return (req, res, next) => {
    const incoming = req.get('x-request-id');
    const requestId = incoming && /^[A-Za-z0-9._-]{1,100}$/.test(incoming) ? incoming : crypto.randomUUID();
    const started = process.hrtime.bigint();
    req.requestId = requestId;
    res.set('X-Request-Id', requestId);
    if (logger?.info) res.on('finish', () => logger.info(JSON.stringify({
      time: new Date().toISOString(), level: 'info', request_id: requestId,
      method: req.method, path: req.path, status: res.statusCode,
      duration_ms: Number(process.hrtime.bigint() - started) / 1e6
    })));
    next();
  };
}

function rateLimit({ windowMs, max }) {
  const buckets = new Map(); let calls = 0;
  return (req, res, next) => {
    const now = Date.now(); const key = req.ip || req.socket.remoteAddress || 'unknown'; const old = buckets.get(key);
    const bucket = !old || old.resetAt <= now ? { count: 0, resetAt: now + windowMs } : old;
    bucket.count += 1; buckets.set(key, bucket); calls += 1;
    if (calls % 100 === 0) for (const [itemKey, item] of buckets) if (item.resetAt <= now) buckets.delete(itemKey);
    res.set('RateLimit-Policy', `${max};w=${Math.ceil(windowMs / 1000)}`); res.set('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) { res.set('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000))); return res.status(429).json({ error: 'Слишком много попыток. Повторите позже.' }); }
    next();
  };
}

function validEmail(value) { return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value.trim()); }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function hashPassword(password) {
  const salt = crypto.randomBytes(16); const derived = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${derived.toString('base64')}`;
}
function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 256) return false;
  if (typeof encoded !== 'string') return false;
  if (!encoded.startsWith('scrypt$')) return safeEqual(hash(password), encoded);
  const [, n, r, p, salt64, expected64] = encoded.split('$');
  if (!n || !r || !p || !salt64 || !expected64) return false;
  try {
    const expected = Buffer.from(expected64, 'base64');
    const actual = crypto.scryptSync(password, Buffer.from(salt64, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}
function safeEqual(left, right) { const a = crypto.createHash('sha256').update(String(left)).digest(); const b = crypto.createHash('sha256').update(String(right)).digest(); return crypto.timingSafeEqual(a, b); }
function createTokenSealer(secret) {
  const key = crypto.createHash('sha256').update(secret).digest();
  const seal = value => { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]); return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.'); };
  seal.open = encoded => {
    const [version, iv64, tag64, body64] = String(encoded).split('.');
    if (version !== 'v1' || !iv64 || !tag64 || !body64) throw new Error('Unsupported encrypted token format.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag64, 'base64url'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body64, 'base64url')), decipher.final()]).toString('utf8'));
  };
  return seal;
}
function publicUser(user) { return Object.fromEntries(USER_KEYS.filter(key => user[key] !== undefined).map(key => [key, key === 'email_verified' ? Boolean(user[key]) : user[key]])); }
function publicAccount(account) { return Object.fromEntries(ACCOUNT_KEYS.filter(key => account[key] !== undefined).map(key => [key, account[key]])); }
function clearCookie(res, secure) { res.clearCookie('otklik_session', { httpOnly: true, sameSite: 'strict', secure, path: '/' }); }
function notifyWebhook(url, item) { fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'request.created', request: item }), signal: AbortSignal.timeout(5000) }).catch(error => console.error('Request webhook failed:', error.message)); }

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
  const app = createApp();
  const server = app.listen(port, host, () => console.log(`Отклик: http://${host}:${port}`));
  const shutdown = () => server.close(() => { app.locals.close(); process.exit(0); });
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}

module.exports = { createApp, PLAN_LIMITS, hashPassword, verifyPassword, createTokenSealer };
