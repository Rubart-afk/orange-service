const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { effectiveDailyLimit } = require('./mail-health');
function installGmail(app, {dbDir, requireSubscription, current, readEmailAccounts, writeEmailAccounts}) {
  const states = new Map(), locks = new Set();
  const file = path.join(dbDir, 'gmail-private.json');
  const read = () => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : {};
  const write = x => {fs.writeFileSync(file+'.tmp',JSON.stringify(x));fs.renameSync(file+'.tmp',file);};
  const config = () => {
    const {GOOGLE_CLIENT_ID:id,GOOGLE_CLIENT_SECRET:secret,GOOGLE_REDIRECT_URI:redirect,MAIL_TOKEN_KEY:key} = process.env;
    if(!id || !secret || !redirect || !/^[a-f0-9]{64}$/i.test(key||'')) throw new Error('Настройте GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI и MAIL_TOKEN_KEY на сервере.');
    return {id,secret,redirect,key:Buffer.from(key,'hex')};
  };
  function seal(value){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',config().key,iv);const data=Buffer.concat([c.update(value,'utf8'),c.final()]);return [iv,c.getAuthTag(),data].map(x=>x.toString('base64')).join('.');}
  function unseal(value){const [iv,tag,data]=value.split('.').map(x=>Buffer.from(x,'base64'));const c=crypto.createDecipheriv('aes-256-gcm',config().key,iv);c.setAuthTag(tag);return Buffer.concat([c.update(data),c.final()]).toString('utf8');}
  async function google(url,options){const r=await fetch(url,{...options,signal:AbortSignal.timeout(20000)});const d=await r.json();if(!r.ok)throw new Error('Google отклонил запрос. Проверьте разрешения и подключение ящика.');return d;}
  const form = body => ({method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});
  app.post('/api/gmail/:id/connect',(req,res)=>{
    const user=requireSubscription(req,res);if(!user)return;
    const a=readEmailAccounts().find(a=>a.id===req.params.id&&a.user_id===user.id&&a.provider==='gmail');if(!a)return res.sendStatus(404);
    try{const c=config(),state=crypto.randomBytes(32).toString('hex'),verifier=crypto.randomBytes(32).toString('base64url');
      for(const [k,s]of states)if(s.until<Date.now())states.delete(k);
      states.set(state,{user:user.id,account:a.id,verifier,until:Date.now()+600000});
      const q=new URLSearchParams({client_id:c.id,redirect_uri:c.redirect,response_type:'code',scope:'openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly',access_type:'offline',prompt:'consent select_account',state,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
      res.json({url:'https://accounts.google.com/o/oauth2/v2/auth?'+q});
    }catch(e){res.status(503).json({error:e.message});}
  });
  app.get('/api/gmail/callback',async(req,res)=>{
    const s=states.get(req.query.state);states.delete(req.query.state);
    const user=current(req);
    if(!s||s.until<Date.now()||!user||s.user!==user.id||!user.tariff||user.tariff==='none')return res.status(403).send('Сессия подключения истекла. Вернитесь на сайт и повторите вход.');
    if(req.query.error||typeof req.query.code!=='string')return res.redirect('/#email-accounts');
    try{const c=config();const tokens=await google('https://oauth2.googleapis.com/token',form({client_id:c.id,client_secret:c.secret,redirect_uri:c.redirect,code:req.query.code,code_verifier:s.verifier,grant_type:'authorization_code'}));
      if(!tokens.refresh_token||!tokens.scope?.split(' ').includes('https://www.googleapis.com/auth/gmail.send'))throw new Error('Не получено разрешение отправлять письма. Повторите подключение и разрешите отправку.');
      const info=await google('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+tokens.access_token}});
      const accounts=readEmailAccounts(),a=accounts.find(a=>a.id===s.account&&a.user_id===user.id);
      if(!a||!info.email_verified||info.email?.toLowerCase()!==a.email)throw new Error('Выбран другой Google-аккаунт. Подключите адрес, указанный на сайте.');
      const secrets=read();secrets[a.id]={refresh:seal(tokens.refresh_token)};write(secrets);
      a.inbox_tracking=Boolean(tokens.scope?.split(' ').includes('https://www.googleapis.com/auth/gmail.readonly'));a.reply_tracking=a.inbox_tracking;a.status='connected';a.enabled=false;a.authorized_at=new Date().toISOString();writeEmailAccounts(accounts);res.redirect('/#email-accounts');
    }catch(e){res.status(400).type('text').send(e.message);}
  });
  const send = async(req,res)=>{
    const user=requireSubscription(req,res);if(!user)return;
    const id=req.params.id,{to,subject,text,key}=req.body||{};
    if(typeof to!=='string'||! /^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(to)||to.length>254||typeof subject!=='string'||!subject.trim()||subject.length>200||/[\r\n]/.test(subject)||typeof text!=='string'||!text.trim()||text.length>10000||typeof key!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(key))return res.status(400).json({error:'Проверьте получателя, тему и текст письма.'});
    if(locks.has(id))return res.status(409).json({error:'Для этого ящика уже выполняется отправка.'});
    const accounts=readEmailAccounts(),a=accounts.find(a=>a.id===id&&a.user_id===user.id);
    if(!a)return res.sendStatus(404);
    if(!a.inbox_tracking)return res.status(409).json({error:'Перед запуском переподключите Google с разрешением на чтение писем: нужна проверка ответов и недоставки.'});
    if(require('./suppression').suppression(dbDir).has(user.id,to))return res.status(409).json({error:'Получатель запретил отправку писем.'});
    const journalFile=path.join(dbDir,'gmail-outbox.json');
    const journal=()=>fs.existsSync(journalFile)?JSON.parse(fs.readFileSync(journalFile,'utf8')):[];
    const saveJournal=items=>{fs.writeFileSync(journalFile+'.tmp',JSON.stringify(items));fs.renameSync(journalFile+'.tmp',journalFile);};
    const previous=journal().find(x=>x.account===id&&x.key===key);
    if(previous)return res.status(previous.status==='sent'?200:409).json({status:previous.status,error:previous.status==='sent'?undefined:'Исход предыдущей отправки не подтверждён. Проверьте «Отправленные» в Gmail; не повторяйте вслепую.'});
    if(!a.enabled||a.status!=='connected'||a.provider!=='gmail'||!read()[id])return res.status(409).json({error:'Подключите Gmail и включите использование ящика.'});
    const day=new Date().toISOString().slice(0,10);
    if(a.counter_date!==day){a.sent_today=0;a.queued_today=0;a.counter_date=day;}
    if(a.sent_today+a.queued_today>=effectiveDailyLimit(a))return res.status(429).json({error:a.warmup_enabled?'Предел плавного старта на сегодня исчерпан (UTC).':'Дневной лимит исчерпан (UTC).'});
    let unsubscribeUrl;
    try{unsubscribeUrl=require('./unsubscribe').unsubscribe(dbDir).issue(user.id,to,process.env.PUBLIC_BASE_URL);}catch(e){return res.status(503).json({error:e.message});}
    const messageText=text+'\n\nЧтобы отказаться от дальнейших писем: '+unsubscribeUrl;
    locks.add(id);let attempted=false;
    try{const c=config();const token=await google('https://oauth2.googleapis.com/token',form({client_id:c.id,client_secret:c.secret,grant_type:'refresh_token',refresh_token:unseal(read()[id].refresh)}));
      const fresh=readEmailAccounts(),live=fresh.find(x=>x.id===id&&x.user_id===user.id),nowUser=current(req);
      if(!nowUser||!nowUser.tariff||nowUser.tariff==='none'||!live.enabled)throw new Error('Отправка остановлена: проверьте подписку и активность почты.');
      if(require('./suppression').suppression(dbDir).has(user.id,to))throw new Error('Получатель запретил отправку писем.');
      if(key.startsWith('sequence-')){
        const sequenceFile=path.join(dbDir,'sequences.json');
        const run=(fs.existsSync(sequenceFile)?JSON.parse(fs.readFileSync(sequenceFile,'utf8')).runs:[]).find(r=>r.userId===user.id&&r.accountId===id&&`sequence-${r.id}-${r.index}`===key);
        if(!run||run.status!=='sending')throw new Error('Цепочка остановлена или поставлена на паузу.');
      }
      if(live.counter_date!==day){live.counter_date=day;live.sent_today=0;live.queued_today=0;}
      if(live.sent_today+live.queued_today>=effectiveDailyLimit(live))throw new Error(live.warmup_enabled?'Предел плавного старта на сегодня исчерпан.':'Дневной лимит исчерпан.');
      const raw=Buffer.from(`From: ${a.email}\r\nTo: ${to}\r\nSubject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=\r\nList-Unsubscribe: <${unsubscribeUrl}>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(messageText).toString('base64').match(/.{1,76}/g).join('\r\n')}`).toString('base64url');
      live.queued_today++;writeEmailAccounts(fresh);saveJournal([...journal(),{account:id,key,status:'unknown',date:day}]);attempted=true;
      const result=await google('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'},body:JSON.stringify({raw})});
      const updated=readEmailAccounts(),done=updated.find(x=>x.id===id);done.queued_today=Math.max(0,done.queued_today-1);done.sent_today++;writeEmailAccounts(updated);
      const entries=journal();Object.assign(entries.find(x=>x.account===id&&x.key===key),{status:'sent',gmail_id:result.id});saveJournal(entries);res.json({status:'sent'});
    }catch(e){res.status(502).json({error:attempted?'Результат отправки неизвестен. Проверьте папку «Отправленные» Gmail перед повтором.':e.message});}finally{locks.delete(id);}
  };
  app.post('/api/gmail/:id/send',(req,res)=>{if(!requireSubscription(req,res))return;res.status(410).json({error:'Ручная отправка человеку отключена.'});});
  async function checkReply(userId,id,to,runId){
    const a=readEmailAccounts().find(x=>x.id===id&&x.user_id===userId);
    if(!a||!a.enabled||a.status!=='connected')throw new Error('Ящик недоступен для проверки ответов.');
    if(!a.inbox_tracking)throw new Error('Переподключите Google и разрешите чтение писем для проверки ответов и недоставки.');
    const journalFile=path.join(dbDir,'gmail-outbox.json');
    const entries=(fs.existsSync(journalFile)?JSON.parse(fs.readFileSync(journalFile,'utf8')):[]).filter(x=>x.account===id&&x.key.startsWith(`sequence-${runId}-`)&&x.status==='sent');
    if(!entries.length)throw new Error('Не найдены отправленные письма для проверки ответов.');
    const c=config(),token=await google('https://oauth2.googleapis.com/token',form({client_id:c.id,client_secret:c.secret,grant_type:'refresh_token',refresh_token:unseal(read()[id].refresh)}));
    const headers={Authorization:'Bearer '+token.access_token};
    const get=route=>google('https://gmail.googleapis.com/gmail/v1/users/me/'+route,{headers});
    const sent=[];
    for(const entry of entries){
      const message=await get('messages/'+encodeURIComponent(entry.gmail_id)+'?format=metadata');
      if(!Number.isFinite(Number(message.internalDate)))throw new Error('Не получена дата отправленного письма.');
      sent.push(message);
    }
    const {scan,header}=require('./mail-events');
    return scan(get,{to,since:Math.min(...sent.map(x=>Number(x.internalDate))),messageIds:sent.map(x=>header(x.payload,'Message-ID')).filter(Boolean)});
  }

  return {send,checkReply};
}
module.exports={installGmail};
