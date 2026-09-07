const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function createApp({ dbDir = process.env.OTKLIK_DATA_DIR || path.join(__dirname, 'database') } = {}) {
  const app = express();
  const sessions = new Map();
  fs.mkdirSync(dbDir, { recursive: true });
  const file = path.join(dbDir, 'users.json');
  const emailAccountsFile = path.join(dbDir, 'email-accounts.json');
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ users: [], campaigns: [], leads: [] }));
  if (!fs.existsSync(emailAccountsFile)) fs.writeFileSync(emailAccountsFile, '[]');
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const write = data => { fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2)); fs.renameSync(file + '.tmp', file); };
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  const safe = ({ password_hash, ...user }) => user;
  const readEmailAccounts = () => JSON.parse(fs.readFileSync(emailAccountsFile, 'utf8'));
  const writeEmailAccounts = data => { fs.writeFileSync(emailAccountsFile + '.tmp', JSON.stringify(data, null, 2)); fs.renameSync(emailAccountsFile + '.tmp', emailAccountsFile); };
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: 'Недопустимый источник запроса' });
    next();
  });
  function token(req) { return (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('otklik_session='))?.slice(15); }
  function current(req) {
    const id = token(req), session = sessions.get(id);
    if (!session) return null;
    if (session.expires < Date.now()) { sessions.delete(id); return null; }
    return read().users.find(u => u.id === session.userId);
  }
  function login(req, res, user) {
    const previous = token(req); if (previous) sessions.delete(previous);
    for (const [key, s] of sessions) if (s.expires < Date.now()) sessions.delete(key);
    const id = crypto.randomBytes(32).toString('hex');
    sessions.set(id, { userId: user.id, expires: Date.now() + 86400000 });
    res.cookie('otklik_session', id, { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: 86400000, path: '/' });
    res.json({ ok: true, user: safe(user) });
  }
  function requireUser(req, res) {
    const user = current(req);
    if (!user) { res.status(401).json({ error: 'Сначала войдите в аккаунт.' }); return null; }
    return user;
  }
  function requireSubscription(req, res) {
    const user = requireUser(req, res);
    if (!user) return null;
    if (!user.tariff || user.tariff === 'none') { res.status(403).json({ error: 'Для подключения почты нужна активная подписка.', code: 'SUBSCRIPTION_REQUIRED' }); return null; }
    return user;
  }
  app.post('/api/register', (req, res) => {
    const { name, email, password, company = '' } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 100 || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 254 || typeof password !== 'string' || password.length < 6 || password.length > 256 || typeof company !== 'string' || company.length > 200) return res.status(400).json({ error: 'Проверьте имя, email и пароль (от 6 символов).' });
    const db = read(), normalized = email.trim().toLowerCase();
    if (db.users.some(u => u.email.toLowerCase() === normalized)) return res.status(409).json({ error: 'Этот email уже зарегистрирован.' });
    const user = { id: crypto.randomUUID(), name: name.trim(), email: normalized, company: company.trim(), password_hash: hash(password), created_at: new Date().toISOString(), tariff: 'none' };
    db.users.push(user); write(db); login(req, res, user);
  });
  app.post('/api/login', (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Введите email и пароль.' });
    const user = read().users.find(u => u.email.toLowerCase() === email.trim().toLowerCase() && u.password_hash === hash(password));
    if (!user) return res.status(401).json({ error: 'Неверный email или пароль.' });
    login(req, res, user);
  });
  app.get('/api/me', (req, res) => { const user = current(req); if (!user) return res.status(401).json({ error: 'Войдите в аккаунт.' }); res.json({ user: safe(user) }); });
  app.post('/api/logout', (req, res) => { sessions.delete(token(req)); res.clearCookie('otklik_session', { path: '/' }); res.json({ ok: true }); });
  app.get(['/api/users', '/api/users/:email'], (req, res) => res.status(403).json({ error: 'Список пользователей закрыт. Свой профиль доступен через /api/me.' }));
  app.get('/api/email-accounts', (req, res) => {
    const user = requireSubscription(req, res); if (!user) return;
    res.json({ accounts: readEmailAccounts().filter(a => a.user_id === user.id) });
  });
  app.post('/api/email-accounts', (req, res) => {
    const user = requireSubscription(req, res); if (!user) return;
    const { provider, email } = req.body || {};
    const providers = ['gmail', 'outlook', 'other'];
    if (!providers.includes(provider) || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 254) return res.status(400).json({ error: 'Выберите провайдера и укажите корректный email.' });
    const normalized = email.trim().toLowerCase(), accounts = readEmailAccounts();
    if (accounts.some(a => a.user_id === user.id && a.email === normalized)) return res.status(409).json({ error: 'Этот почтовый ящик уже добавлен.' });
    const account = { id: crypto.randomUUID(), user_id: user.id, provider, email: normalized, status: 'authorization_required', enabled: false, daily_limit: 25, sent_today: 0, queued_today: 0, created_at: new Date().toISOString(), counter_date: new Date().toISOString().slice(0, 10) };
    accounts.push(account); writeEmailAccounts(accounts); res.status(201).json({ account });
  });
  app.patch('/api/email-accounts/:id', (req, res) => {
    const user = requireSubscription(req, res); if (!user) return;
    const accounts = readEmailAccounts(), account = accounts.find(a => a.id === req.params.id && a.user_id === user.id);
    if (!account) return res.status(404).json({ error: 'Почтовый ящик не найден.' });
    const { enabled, daily_limit } = req.body || {};
    if (enabled !== undefined) {
      if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'Некорректное состояние ящика.' });
      if (enabled && account.status !== 'connected') return res.status(409).json({ error: 'Сначала завершите авторизацию у почтового провайдера.', code: 'AUTHORIZATION_REQUIRED' });
      account.enabled = enabled;
    }
    if (daily_limit !== undefined) {
      if (!Number.isInteger(daily_limit) || daily_limit < 1 || daily_limit > 500) return res.status(400).json({ error: 'Дневной лимит должен быть от 1 до 500 писем.' });
      account.daily_limit = daily_limit;
    }
    account.updated_at = new Date().toISOString(); writeEmailAccounts(accounts); res.json({ account });
  });
  app.post('/api/email-accounts/:id/authorize', (req, res) => {
    const user = requireSubscription(req, res); if (!user) return;
    const accounts = readEmailAccounts(), account = accounts.find(a => a.id === req.params.id && a.user_id === user.id);
    if (!account) return res.status(404).json({ error: 'Почтовый ящик не найден.' });
    if (process.env.EMAIL_OAUTH_DEMO !== '1') return res.status(501).json({ error: 'OAuth ещё не настроен. Для реального подключения нужны ключи Google или Microsoft.', code: 'OAUTH_NOT_CONFIGURED' });
    account.status = 'connected'; account.authorized_at = new Date().toISOString(); writeEmailAccounts(accounts); res.json({ account, demo: true });
  });
  app.post('/api/requests', (req, res) => {
    const { email, message } = req.body || {};
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof message !== 'string' || message.trim().length < 10 || message.length > 3000) return res.status(400).json({ error: 'Укажите email и опишите задачу (10–3000 символов).' });
    const requestFile = path.join(dbDir, 'requests.json');
    const items = fs.existsSync(requestFile) ? JSON.parse(fs.readFileSync(requestFile, 'utf8')) : [];
    const id = crypto.randomUUID(); items.push({ id, email, message: message.trim(), created_at: new Date().toISOString() });
    fs.writeFileSync(requestFile + '.tmp', JSON.stringify(items, null, 2)); fs.renameSync(requestFile + '.tmp', requestFile);
    res.status(201).json({ ok: true, id });
  });
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Метод не найден.' }));
  app.use((err, req, res, next) => { console.error(err.message); res.status(err.status || 500).json({ error: err.status === 400 ? 'Некорректный запрос.' : 'Не удалось обработать запрос. Попробуйте ещё раз.' }); });
  return app;
}
if (require.main === module) createApp().listen(process.env.PORT || 3000, '127.0.0.1', () => console.log(`Отклик: http://localhost:${process.env.PORT || 3000}`));
module.exports = { createApp };
