const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const formats=new Map();
function localParts(date,zone){
  if(!formats.has(zone))formats.set(zone,new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23',minute:'2-digit'}));
  return Object.fromEntries(formats.get(zone).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
}
// Calendar-day delays, respecting the selected IANA timezone (including DST).
function nextSlot(after,days,hour,zone,weekdays=true){
  const p=localParts(after,zone),calendar=new Date(Date.UTC(p.year,p.month-1,p.day+days));
  for(let n=0;n<370;n++,calendar.setUTCDate(calendar.getUTCDate()+1)){
    if(weekdays&&[0,6].includes(calendar.getUTCDay()))continue;
    const target=Date.UTC(calendar.getUTCFullYear(),calendar.getUTCMonth(),calendar.getUTCDate(),hour);
    let value=target;
    for(let i=0;i<4;i++){const q=localParts(new Date(value),zone);value+=target-Date.UTC(q.year,q.month-1,q.day,q.hour,q.minute);}
    const q=localParts(new Date(value),zone);
    if(q.hour===hour&&q.day===calendar.getUTCDate()&&value>=after.getTime())return new Date(value).toISOString();
  }
  throw new Error('Не удалось подобрать время отправки.');
}
function followupAt(after,minutes,t){
  const due=new Date(after.getTime()+minutes*60000),p=localParts(due,t.timeZone);
  if(t.weekdays&&[0,6].includes(new Date(Date.UTC(p.year,p.month-1,p.day)).getUTCDay()))return nextSlot(due,0,t.hour,t.timeZone,true);
  return due.toISOString();
}
function migrate(db){
  for(const t of [...db.templates,...db.runs.map(r=>r.template)])for(const [i,s]of t.steps.entries()){
    if(s.delayMinutes===undefined)s.delayMinutes=i?(s.delayDays||1)*1440:0;
    delete s.delayDays;
  }
  return db;
}
function validate(body){
  if(!body||typeof body.name!=='string'||!body.name.trim()||body.name.length>100)throw new Error('Название: от 1 до 100 символов.');
  if(!Array.isArray(body.steps)||body.steps.length<1||body.steps.length>8)throw new Error('В цепочке должно быть от 1 до 8 писем.');
  const steps=body.steps.map((s,i)=>{
    if(!s||typeof s.subject!=='string'||!s.subject.trim()||s.subject.length>200||/[\r\n]/.test(s.subject)||typeof s.text!=='string'||!s.text.trim()||s.text.length>10000)throw new Error('У каждого письма должны быть тема (до 200) и текст (до 10000 символов).');
    if(i&&(!Number.isInteger(s.delayMinutes)||s.delayMinutes<1||s.delayMinutes>129600))throw new Error('Интервал между письмами: от 1 до 129600 минут.');
    return {subject:s.subject.trim(),text:s.text,delayMinutes:i?s.delayMinutes:0};
  });
  if(!Number.isInteger(body.hour)||body.hour<0||body.hour>23||typeof body.timeZone!=='string'||typeof body.weekdays!=='boolean')throw new Error('Проверьте время и часовой пояс.');
  try{localParts(new Date(),body.timeZone);}catch{throw new Error('Неизвестный часовой пояс.');}
  return {name:body.name.trim(),steps,hour:body.hour,timeZone:body.timeZone,weekdays:body.weekdays};
}
function installSequences(app,{dbDir,requireSubscription,readEmailAccounts,readSelectedCompanies=()=>null,send,checkReply,now=()=>new Date()}){
  const blocked=require('./suppression').suppression(dbDir);
  app.get('/api/suppression',(req,res)=>{const u=requireSubscription(req,res);if(u)res.json({addresses:blocked.list(u.id)});});
  app.post('/api/suppression',(req,res)=>{const u=requireSubscription(req,res);if(!u)return;const email=req.body?.email;if(typeof email!=='string'||email.length>254||!/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(email.trim()))return res.status(400).json({error:'Введите корректный email.'});blocked.add(u.id,email);res.json({ok:true});});
  const file=path.join(dbDir,'sequences.json');
  const read=()=>migrate(fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{templates:[],runs:[]});
  const write=db=>{fs.writeFileSync(file+'.tmp',JSON.stringify(db,null,2));fs.renameSync(file+'.tmp',file);};
  app.get('/api/sequences',(req,res)=>{const u=requireSubscription(req,res);if(!u)return;const db=read();res.json({templates:db.templates.filter(x=>x.userId===u.id),runs:db.runs.filter(x=>x.userId===u.id)});});
  app.post('/api/sequences/pause-all',(req,res)=>{
    const u=requireSubscription(req,res);if(!u)return;const db=read();let paused=0;
    for(const r of db.runs)if(r.userId===u.id&&['active','sending'].includes(r.status)){r.status='paused';paused++;}
    write(db);res.json({paused});
  });
  function save(req,res){
    const u=requireSubscription(req,res);if(!u)return;
    try{const value=validate(req.body),db=read();let t;
      if(req.params.id){t=db.templates.find(x=>x.id===req.params.id&&x.userId===u.id);if(!t)return res.sendStatus(404);Object.assign(t,value);}
      else{t={...value,id:crypto.randomUUID(),userId:u.id};db.templates.push(t);}
      t.updatedAt=now().toISOString();write(db);res.json({template:t});
    }catch(e){res.status(400).json({error:e.message});}
  }
  app.post('/api/sequences/templates',save);app.put('/api/sequences/templates/:id',save);
  app.post('/api/sequences/runs',(req,res)=>{
    const u=requireSubscription(req,res);if(!u)return;
    const db=read(),{templateId,accountId,to,companyIds,startAt,acknowledged}=req.body||{};
    const t=db.templates.find(x=>x.id===templateId&&x.userId===u.id),a=readEmailAccounts().find(x=>x.id===accountId&&x.user_id===u.id&&x.provider==='gmail'&&x.enabled&&x.status==='connected');
    if(!t||!a)return res.status(400).json({error:'Выберите шаблон и подключённый, включённый Gmail.'});
    if(acknowledged!==true)return res.status(400).json({error:'Подтвердите условия запуска.'});
    const start=new Date(startAt);if(typeof startAt!=='string'||!Number.isFinite(start.getTime())||start<now()||start.getTime()>now().getTime()+366*86400000)return res.status(400).json({error:'Выберите будущее время в пределах года.'});
    let recipients;
    if(Array.isArray(companyIds)){
      if(companyIds.length<1||companyIds.length>100||companyIds.some(id=>typeof id!=='string'))return res.status(400).json({error:'Выберите от 1 до 100 компаний.'});
      const requested=[...new Set(companyIds)],selected=readSelectedCompanies(u.id);
      if(!Array.isArray(selected))return res.status(400).json({error:'Запуск по списку компаний недоступен.'});
      const byId=new Map(selected.map(x=>[x.companyId,x]));
      const invalid=requested.filter(id=>{const x=byId.get(id);return !x||!x.enabled||!x.company?.email;});
      if(invalid.length)return res.status(400).json({error:'Все выбранные компании должны быть включены и иметь email.'});
      recipients=requested.map(id=>{const x=byId.get(id),c=x.company;return {to:c.email,company:{id:c.id,name:c.name,city:c.city||''}};});
    }else recipients=[{to}];
    const email=/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/;
    if(recipients.some(x=>typeof x.to!=='string'||x.to.length>254||!email.test(x.to)))return res.status(400).json({error:'У каждого получателя должен быть корректный email.'});
    const unique=new Map(recipients.map(x=>[x.to.toLowerCase(),x]));recipients=[...unique.values()];
    if(recipients.some(x=>blocked.has(u.id,x.to)))return res.status(409).json({error:'В списке есть адрес с запретом отправки. Исключите его из получателей.'});
    const active=new Set(db.runs.filter(x=>x.userId===u.id&&x.accountId===accountId&&['active','sending','paused','error'].includes(x.status)).map(x=>x.to));
    const duplicates=recipients.filter(x=>active.has(x.to.toLowerCase()));
    if(duplicates.length)return res.status(409).json({error:`У ${duplicates.length} получателей уже есть незавершённая цепочка для этого ящика.`});
    const exactStart=req.body.startMode==='exact';
    const nextAt=exactStart?followupAt(start,0,t):nextSlot(start,0,t.hour,t.timeZone,t.weekdays),createdAt=now().toISOString();
    const runs=recipients.map(recipient=>({id:crypto.randomUUID(),userId:u.id,accountId,to:recipient.to.toLowerCase(),company:recipient.company,template:JSON.parse(JSON.stringify(t)),index:0,status:'active',exactStart,nextAt,history:[],createdAt}));
    db.runs.push(...runs);write(db);res.status(201).json({run:runs[0],runs,created:runs.length});
  });
  app.patch('/api/sequences/runs/:id',(req,res)=>{
    const u=requireSubscription(req,res);if(!u)return;const db=read(),r=db.runs.find(x=>x.id===req.params.id&&x.userId===u.id);if(!r)return res.sendStatus(404);
    const action=req.body?.action;
    if(!['pause','resume','stop'].includes(action)||['completed','stopped'].includes(r.status))return res.status(409).json({error:'Это действие недоступно.'});
    if(action==='resume'){
      if(r.status!=='paused'&&r.status!=='error')return res.status(409).json({error:'Цепочка уже работает.'});
      if(r.uncertain)return res.status(409).json({error:'Исход отправки неизвестен: проверьте «Отправленные». Автоповтор заблокирован.'});
      r.status='active';const resumeAt=new Date(Math.max(now().getTime(),new Date(r.nextAt).getTime()));r.nextAt=(r.index||r.exactStart)?followupAt(resumeAt,0,r.template):nextSlot(resumeAt,0,r.template.hour,r.template.timeZone,r.template.weekdays);delete r.error;
    }else r.status=action==='pause'?'paused':'stopped';
    write(db);res.json({run:r});
  });
  let busy=false,timer;
  async function tick(){
    if(busy)return;busy=true;
    try{
      // Continue monitoring paused and completed runs for 30 days after the last send.
      if(checkReply){
        let inspected=0;
        for(const candidate of read().runs){
          const last=candidate.history.filter(x=>x.status==='accepted').at(-1)?.at;
          if(!last||!['paused','completed'].includes(candidate.status)||now()-new Date(last)>30*86400000||now()-new Date(candidate.inboxCheckedAt||0)<300000)continue;
          if(++inspected>10)break;
          let event,error;try{event=await checkReply(candidate.userId,candidate.accountId,candidate.to,candidate.id);}catch(e){error=e.message;}
          const db=read(),r=db.runs.find(x=>x.id===candidate.id);if(!r||r.status!==candidate.status)continue;
          r.inboxCheckedAt=now().toISOString();r.inboxError=error||null;
          if(event){const type=event===true?'replied':event.type;r.status=type==='delayed'?'paused':'stopped';r.error=type==='bounced'?'Постоянная ошибка доставки: адрес заблокирован.':type==='delayed'?'Задержка доставки.':'Получен ответ.';if(type==='bounced')blocked.add(r.userId,r.to,'hard_bounce');if(!r.history.some(h=>h.eventId===event.id&&h.status===type))r.history.push({at:now().toISOString(),status:type,eventId:event.id});}
          write(db);
        }
      }
      const used=new Set();
      for(const candidate of read().runs){
        if(!['active','sending'].includes(candidate.status)||new Date(candidate.nextAt)>now()||used.has(candidate.accountId))continue;
        let db=read(),r=db.runs.find(x=>x.id===candidate.id);if(!['active','sending'].includes(r.status))continue;
        if(blocked.has(r.userId,r.to)){r.status='stopped';r.error='Получатель в списке запретов.';write(db);continue;}
        const key=`sequence-${r.id}-${r.index}`;
        // Recover a crash using the same Gmail idempotency key before deciding to send again.
        const journalPath=path.join(dbDir,'gmail-outbox.json');
        const entry=fs.existsSync(journalPath)?JSON.parse(fs.readFileSync(journalPath,'utf8')).find(x=>x.account===r.accountId&&x.key===key):undefined;
        let result;
        if(entry)result=entry.status==='sent'?{code:200,status:'sent'}:{code:409,error:'Исход отправки неизвестен. Проверьте «Отправленные».',uncertain:true};
        else{
          const p=localParts(now(),r.template.timeZone);
          const weekday=new Date(Date.UTC(p.year,p.month-1,p.day)).getUTCDay();
          if((r.index===0&&!r.exactStart&&p.hour!==r.template.hour)||(r.template.weekdays&&[0,6].includes(weekday))){r.nextAt=(r.index||r.exactStart)?followupAt(now(),0,r.template):nextSlot(now(),0,r.template.hour,r.template.timeZone,r.template.weekdays);r.status='active';write(db);continue;}
          if(r.index>0&&checkReply){
            let replied=false,checkError;
            try{replied=await checkReply(r.userId,r.accountId,r.to,r.id);}catch(e){checkError=e.message;}
            db=read();r=db.runs.find(x=>x.id===candidate.id);
            if(!r||!['active','sending'].includes(r.status))continue;
            if(replied){const type=replied===true?'replied':replied.type;r.status=type==='delayed'?'error':'stopped';r.error=type==='bounced'?'Постоянная ошибка доставки: адрес заблокирован.':type==='delayed'?'Задержка доставки: цепочка приостановлена.':'Получен ответ: дальнейшие письма остановлены.';if(type==='bounced')blocked.add(r.userId,r.to,'hard_bounce');r.history.push({at:now().toISOString(),status:type});write(db);continue;}
            if(checkError){r.status='error';r.error='Проверка ответов: '+checkError;r.uncertain=false;write(db);continue;}
            if(blocked.has(r.userId,r.to)){r.status='stopped';r.error='Получатель в списке запретов.';write(db);continue;}
          }
          r.status='sending';write(db);used.add(r.accountId);
          const step=r.template.steps[r.index],fields={company:r.company?.name||'',city:r.company?.city||''};
          const merge=value=>value.replace(/\{\{(company|city)\}\}/g,(_,name)=>fields[name]);
          try{result=await send(r.userId,r.accountId,{to:r.to,subject:merge(step.subject).replace(/[\r\n]+/g,' '),text:merge(step.text),delayMinutes:step.delayMinutes,key});}catch{result={code:502,error:'Ошибка сервера. Проверьте «Отправленные» перед продолжением.',uncertain:true};}
        }
        db=read();r=db.runs.find(x=>x.id===candidate.id);
        if(result.code===200&&result.status==='sent'){
          r.history.push({step:r.index+1,at:now().toISOString(),status:'accepted'});r.index++;
          if(r.index===r.template.steps.length)r.status=r.status==='stopped'?'stopped':'completed';
          else{r.nextAt=followupAt(now(),r.template.steps[r.index].delayMinutes,r.template);if(r.status==='sending')r.status='active';}
          delete r.error;
        }else if(result.code===429){r.nextAt=nextSlot(now(),1,r.template.hour,r.template.timeZone,r.template.weekdays);if(r.status==='sending')r.status='active';r.error='Дневной лимит: перенесено на следующий разрешённый день.';}
        else{if(r.status==='sending'||r.status==='active')r.status='error';r.error=result.error||'Отправка приостановлена.';r.uncertain=Boolean(result.uncertain||/неизвестен|не подтверждён/.test(r.error));}
        write(db);
      }
    }finally{busy=false;}
  }
  return {tick,start(){if(!timer){timer=setInterval(()=>tick().catch(()=>console.error('Sequence worker failed')),60000);timer.unref();tick().catch(()=>console.error('Sequence worker failed'));}},stop(){clearInterval(timer);timer=undefined;}};
}
module.exports={installSequences,nextSlot,followupAt,migrate,validate};
