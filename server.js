const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

function createApp({ dbDir = process.env.OTKLIK_DATA_DIR || path.join(__dirname, 'database'), resolveTxt } = {}) {
  const app = express();
  const internalUser = Symbol('scheduler-user');
  fs.mkdirSync(dbDir, { recursive: true });
  const file = path.join(dbDir, 'users.json');
  const emailAccountsFile = path.join(dbDir, 'email-accounts.json');
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ users: [], campaigns: [], leads: [] }));
  if (!fs.existsSync(emailAccountsFile)) fs.writeFileSync(emailAccountsFile, '[]');
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const write = data => { fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2)); fs.renameSync(file + '.tmp', file); };
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  const sessionFile=path.join(dbDir,'sessions.json');
  const readSessions=()=>fs.existsSync(sessionFile)?JSON.parse(fs.readFileSync(sessionFile,'utf8')):{};
  const saveSessions=data=>{fs.writeFileSync(sessionFile+'.tmp',JSON.stringify(data),{mode:0o600});fs.renameSync(sessionFile+'.tmp',sessionFile);};
  function revokeSession(req){const value=token(req);if(!value)return;const data=readSessions();delete data[hash(value)];saveSessions(data);}
  const safe = ({ password_hash, ...user }) => user;
  const readEmailAccounts = () => JSON.parse(fs.readFileSync(emailAccountsFile, 'utf8'));
  const writeEmailAccounts = data => { fs.writeFileSync(emailAccountsFile + '.tmp', JSON.stringify(data, null, 2)); fs.renameSync(emailAccountsFile + '.tmp', emailAccountsFile); };
  app.disable('x-powered-by');
  app.get(['/healthz', '/readyz'], (req, res) => res.json({ok:true}));
  require('./security').installSecurity(app);
  require('./unsubscribe').unsubscribe(dbDir).install(app);
  app.use('/api/sequences',express.json({limit:'128kb'}));
  app.use(express.json({ limit: '16kb' }));
  app.use('/api/login', require('./security').limiter({limit:10,windowMs:15*60000,key:require('./security').accountKey}));
  function token(req) { return (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('otklik_session='))?.slice(15); }
  function current(req) {
    if(req[internalUser]) return read().users.find(u=>u.id===req[internalUser]);
    const id = token(req), session = id&&readSessions()[hash(id)];
    if (!session) return null;
    if (!Number.isFinite(session.expires)||session.expires <= Date.now()) { revokeSession(req); return null; }
    return read().users.find(u => u.id === session.userId);
  }
  function login(req, res, user) {
    const data=readSessions(),previous=token(req);if(previous)delete data[hash(previous)];
    for(const [key,s]of Object.entries(data))if(!Number.isFinite(s.expires)||s.expires<=Date.now())delete data[key];
    const id = crypto.randomBytes(32).toString('hex');
    data[hash(id)]={userId:user.id,expires:Date.now()+86400000};saveSessions(data);
    res.cookie('otklik_session', id, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' || req.secure, maxAge: 86400000, path: '/' });
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
  app.post('/api/register', async (req, res) => {
    const { name, email, password, company = '' } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 100 || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 254 || typeof password !== 'string' || password.length < 8 || password.length > 256 || typeof company !== 'string' || company.length > 200) return res.status(400).json({ error: 'Проверьте имя, email и пароль (от 8 символов).' });
    const password_hash=await require('./passwords').passwordHash(password);
    const db = read(), normalized = email.trim().toLowerCase();
    if (db.users.some(u => u.email.toLowerCase() === normalized)) return res.status(409).json({ error: 'Этот email уже зарегистрирован.' });
    const user = { id: crypto.randomUUID(), name: name.trim(), email: normalized, company: company.trim(), password_hash, created_at: new Date().toISOString(), tariff: 'none' };
    db.users.push(user); write(db); login(req, res, user);
  });
  app.post('/api/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || email.length>254 || typeof password !== 'string' || password.length>256) return res.status(400).json({ error: 'Введите email и пароль.' });
    const user = read().users.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!user||!await require('./passwords').verifyPassword(password,user.password_hash)) return res.status(401).json({ error: 'Неверный email или пароль.' });
    if(!user.password_hash.startsWith('scrypt$')){const upgraded=await require('./passwords').passwordHash(password),db=read(),live=db.users.find(x=>x.id===user.id);if(live){live.password_hash=upgraded;write(db);}}
    login(req, res, user);
  });
  app.get('/api/me', (req, res) => { const user = current(req); if (!user) return res.status(401).json({ error: 'Войдите в аккаунт.' }); res.json({ user: safe(user) }); });
  app.post('/api/logout', (req, res) => { revokeSession(req); res.clearCookie('otklik_session', { path: '/' }); res.json({ ok: true }); });
  app.get(['/api/users', '/api/users/:email'], (req, res) => res.status(403).json({ error: 'Список пользователей закрыт. Свой профиль доступен через /api/me.' }));
  app.get('/api/readiness',(req,res)=>{
    const user=requireSubscription(req,res);if(!user)return;
    let publicUrl=false;try{const url=new URL(process.env.PUBLIC_BASE_URL);publicUrl=url.protocol==='https:'&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname);}catch{}
    res.json({publicUrl,googleConfigured:Boolean(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET&&process.env.GOOGLE_REDIRECT_URI&&/^[a-f0-9]{64}$/i.test(process.env.MAIL_TOKEN_KEY||'')),backup:app.locals.backups?.state||{lastSuccess:null,error:'Резервное копирование не запущено.'},accounts:readEmailAccounts().filter(a=>a.user_id===user.id).map(a=>({email:a.email,connected:a.status==='connected'&&a.provider==='gmail',inboxTracking:Boolean(a.inbox_tracking)}))});
  });
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
  const gmail = require('./gmail').installGmail(app, {dbDir,requireSubscription,current,readEmailAccounts,writeEmailAccounts});
  require('./mail-health').installMailHealth(app,{requireSubscription,readEmailAccounts,writeEmailAccounts,resolveTxt});
  const companyService=require('./companies').installCompanies(app,{dbDir,requireUser});
  app.locals.sequences = require('./sequences').installSequences(app, {
    dbDir, requireSubscription, readEmailAccounts,checkReply:gmail.checkReply,
    readSelectedCompanies:userId=>companyService.selectedFor(userId),
    send: async(userId,id,body)=>{
      let code=200,result;
      const res={status(n){code=n;return this;},json(data){result=data;return this;},sendStatus(n){code=n;result={error:'Ящик недоступен.'};return this;}};
      await gmail.send({[internalUser]:userId,params:{id},body},res);
      return {code,...result};
    }
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
  app.use((err, req, res, next) => { console.error('Request failed:', err.status || 500); res.status(err.status || 500).json({ error: err.status === 400 ? 'Некорректный запрос.' : 'Не удалось обработать запрос. Попробуйте ещё раз.' }); });
  return app;
}
if (require.main === module) {
  const app=createApp();
  app.locals.backups=require('./backup').startBackups(process.env.OTKLIK_DATA_DIR||path.join(__dirname,'database'));
  const server=app.listen(process.env.PORT || 3000, process.env.HOST || '127.0.0.1', () => {app.locals.sequences.start();console.log(`Отклик: http://localhost:${process.env.PORT || 3000}`);});
  server.requestTimeout=30000;
  server.headersTimeout=15000;
  server.keepAliveTimeout=5000;
  server.maxRequestsPerSocket=1000;
}
module.exports = { createApp };
