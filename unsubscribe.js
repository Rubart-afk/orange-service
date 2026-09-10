const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {suppression}=require('./suppression');
function unsubscribe(dbDir){
 const file=path.join(dbDir,'unsubscribe-tokens.json');
 const read=()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];
 const digest=t=>crypto.createHash('sha256').update(t).digest('hex');
 const find=t=>typeof t==='string'&&/^[a-f0-9]{64}$/.test(t)?read().find(x=>x.hash===digest(t)):null;
 return {
  issue(userId,email,base){
   let url;try{url=new URL(base);}catch{throw new Error('Настройте PUBLIC_BASE_URL для ссылок отписки.');}
   if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('PUBLIC_BASE_URL должен быть публичным HTTPS-адресом сайта без пути.');
   const token=crypto.randomBytes(32).toString('hex'),items=read();
   items.push({hash:digest(token),userId,email:email.trim().toLowerCase()});
   fs.writeFileSync(file+'.tmp',JSON.stringify(items));fs.renameSync(file+'.tmp',file);
   return url.origin+'/unsubscribe/'+token;
  },
  install(app){
   const page=(message,form='')=>'<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Отписка — Отклик</title><body style="font:18px system-ui;max-width:600px;margin:80px auto;padding:24px"><h1>Отписка от писем</h1><p>'+message+'</p>'+form+'</body></html>';
   app.get('/unsubscribe/:token',(req,res)=>{
    res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"});
    if(!find(req.params.token))return res.status(404).send(page('Ссылка недействительна.'));
    res.send(page('Подтвердите отказ от дальнейших писем этого отправителя.','<form method="post"><button type="submit">Отписаться</button></form>'));
   });
   app.post('/unsubscribe/:token',(req,res)=>{
    res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
    const item=find(req.params.token);if(!item)return res.status(404).send(page('Ссылка недействительна.'));
    suppression(dbDir).add(item.userId,item.email,'unsubscribe');
    res.send(page('Вы отписались. Новые письма этого отправителя будут заблокированы.'));
   });
  }
 };
}
module.exports={unsubscribe};
