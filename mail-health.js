function ageDays(account, now = new Date()) {
  const started = new Date(account.authorized_at || account.created_at || now);
  return Number.isFinite(started.getTime()) ? Math.max(0, Math.floor((now.getTime() - started.getTime()) / 86400000)) : 0;
}
function recommendedDailyLimit(days) {
  if (days < 4) return 5;
  if (days < 8) return 10;
  if (days < 15) return 18;
  if (days < 22) return 30;
  if (days < 31) return 45;
  return 60;
}
function effectiveDailyLimit(account, now = new Date()) {
  const configured = Number.isInteger(account.daily_limit) ? account.daily_limit : 25;
  return account.warmup_enabled ? Math.min(configured, recommendedDailyLimit(ageDays(account, now))) : configured;
}
function present(account, now = new Date()) {
  const days = ageDays(account, now), recommended = recommendedDailyLimit(days), effective = effectiveDailyLimit(account, now);
  const connected = account.provider === 'gmail' && account.status === 'connected';
  const state = !connected ? 'needs_connection' : !account.enabled ? 'paused' : account.warmup_enabled ? (days < 31 ? 'warming' : 'steady') : 'ready';
  return {
    id: account.id, email: account.email, provider: account.provider, connected, enabled: Boolean(account.enabled), warmup_enabled: Boolean(account.warmup_enabled),
    days_connected: days, sent_today: account.sent_today || 0, queued_today: account.queued_today || 0,
    daily_limit: account.daily_limit || 25, recommended_limit: recommended, effective_limit: effective,
    remaining_today: Math.max(0, effective - (account.sent_today || 0) - (account.queued_today || 0)), state
  };
}
async function diagnoseDomain(email, resolveTxt = dns.resolveTxt) {
  const domain = String(email || '').split('@')[1]?.toLowerCase();
  if (!domain) return { domain: '', spf: 'unavailable', dmarc: 'unavailable', dkim: 'unavailable' };
  const lookup = async name => {
    try { return (await resolveTxt(name)).map(parts => parts.join('')); }
    catch (error) { return ['ENODATA','ENOTFOUND','NXDOMAIN'].includes(error?.code) ? [] : null; }
  };
  const [root, dmarc] = await Promise.all([lookup(domain), lookup(`_dmarc.${domain}`)]);
  const status = (records, prefix) => records === null ? 'unavailable' : records.some(x => x.toLowerCase().startsWith(prefix.toLowerCase())) ? 'pass' : 'missing';
  const managed = ['gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','yahoo.com','yandex.ru','mail.ru'].includes(domain);
  return { domain, spf: status(root, 'v=spf1'), dmarc: status(dmarc, 'v=dmarc1'), dkim: managed ? 'provider_managed' : 'selector_required' };
}
function installMailHealth(app, { requireSubscription, readEmailAccounts, writeEmailAccounts, now = () => new Date(), resolveTxt = dns.resolveTxt }) {
  app.get('/api/mail-health', async (req, res) => {
    const user = requireSubscription(req, res); if (!user) return;
    const accounts = readEmailAccounts().filter(x => x.user_id === user.id);
    const values = await Promise.all(accounts.map(async account => ({ ...present(account, now()), domain_health: await diagnoseDomain(account.email, resolveTxt) })));
    res.json({ accounts: values });
  });
  app.patch('/api/mail-health/:id', (req, res) => {
    const user = requireSubscription(req, res); if (!user) return;
    if (typeof req.body?.warmup_enabled !== 'boolean') return res.status(400).json({ error: 'Укажите состояние плавного старта.' });
    const accounts = readEmailAccounts(), account = accounts.find(x => x.id === req.params.id && x.user_id === user.id);
    if (!account) return res.sendStatus(404);
    account.warmup_enabled = req.body.warmup_enabled;
    account.updated_at = now().toISOString(); writeEmailAccounts(accounts);
    res.json({ account: present(account, now()) });
  });
  return { present };
}
module.exports = { ageDays, recommendedDailyLimit, effectiveDailyLimit, present, diagnoseDomain, installMailHealth };
const dns = require('node:dns').promises;
