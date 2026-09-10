const crypto = require('node:crypto');

// Bounded, process-local limits: deploy one Node process, with an edge limit as well.
function limiter({limit, windowMs, key = req => req.ip, now = Date.now}) {
  const buckets = new Map();
  return (req, res, next) => {
    const time = now();
    for (const [id, bucket] of buckets) if (bucket.until <= time) buckets.delete(id);
    const id = key(req);
    let bucket = buckets.get(id);
    if (!bucket) {
      if (buckets.size >= 10000) return res.status(429).set('Retry-After', '60').json({error:'Слишком много запросов. Повторите позже.'});
      bucket = {count:0, until:time + windowMs}; buckets.set(id, bucket);
    }
    if (++bucket.count > limit) return res.status(429).set('Retry-After', String(Math.ceil((bucket.until-time)/1000))).json({error:'Слишком много попыток. Повторите позже.'});
    next();
  };
}
function installSecurity(app, {production = process.env.NODE_ENV === 'production', publicBase = process.env.PUBLIC_BASE_URL, trustLoopback = process.env.TRUST_LOOPBACK_PROXY === '1'} = {}) {
  let origin;
  if (production) {
    const url = new URL(publicBase);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || ['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('Production requires a public HTTPS origin in PUBLIC_BASE_URL');
    if (process.env.EMAIL_OAUTH_DEMO === '1') throw new Error('Demo OAuth is forbidden in production');
    origin = url.origin;
  }
  app.set('trust proxy', trustLoopback ? 'loopback' : false);
  app.use((req,res,next) => {
    res.set({'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"});
    if (req.path.startsWith('/api/') || req.path.startsWith('/unsubscribe/')) res.set('Cache-Control','no-store');
    if (production) {
      if (req.get('host') !== new URL(origin).host) return res.status(400).json({error:'Недопустимый адрес сайта.'});
      if (!req.secure) return res.status(400).json({error:'Требуется HTTPS.'});
      res.set('Strict-Transport-Security','max-age=31536000');
    }
    if (req.path.startsWith('/api/') && !['GET','HEAD','OPTIONS'].includes(req.method)) {
      const expected = origin || `${req.protocol}://${req.get('host')}`;
      if (req.get('sec-fetch-site') === 'cross-site' || (req.get('origin') && req.get('origin') !== expected)) return res.status(403).json({error:'Недопустимый источник запроса.'});
      // Browser forms cannot use JSON without a preflight. Empty commands remain valid.
      if ((req.headers['transfer-encoding'] || Number(req.headers['content-length']) > 0) && !req.is('application/json')) return res.status(415).json({error:'Требуется JSON.'});
    }
    next();
  });
  app.use('/api', limiter({limit:300,windowMs:60000}));
  app.use(['/api/login','/api/register'], limiter({limit:20,windowMs:15*60000}));
  app.use('/api/requests', limiter({limit:5,windowMs:3600000}));
  // Bound expensive password derivations independently of client addresses.
  let active = 0;
  app.use(['/api/login','/api/register'], (req,res,next) => {
    if (req.method !== 'POST') return next();
    if (active >= 4) return res.status(429).set('Retry-After','5').json({error:'Сервис занят. Повторите через несколько секунд.'});
    active++; let released=false;
    const release=()=>{if(!released){released=true;active--;}};
    res.once('finish',release);res.once('close',release);next();
  });
}
function accountKey(req) {return crypto.createHash('sha256').update(String(req.body?.email || '').trim().toLowerCase()).digest('hex');}
module.exports={installSecurity,limiter,accountKey};
