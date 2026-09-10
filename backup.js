const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function key(value){if(!/^[a-f0-9]{64}$/i.test(value||''))throw new Error('Для резервной копии нужен MAIL_TOKEN_KEY (64 hex-символа).');return Buffer.from(value,'hex');}
function backup(dbDir,destination,secret){
 const encryptionKey=key(secret),files={};
 for(const name of fs.readdirSync(dbDir).filter(x=>x.endsWith('.json'))){const text=fs.readFileSync(path.join(dbDir,name),'utf8');JSON.parse(text);files[name]=text;}
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',encryptionKey,iv);
 const data=Buffer.concat([cipher.update(JSON.stringify({version:1,files}),'utf8'),cipher.final()]);
 fs.mkdirSync(destination,{recursive:true});
 const target=path.join(destination,new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(4).toString('hex')+'.backup');
 fs.writeFileSync(target+'.tmp',Buffer.concat([iv,cipher.getAuthTag(),data]),{mode:0o600});fs.renameSync(target+'.tmp',target);
 return target;
}
function restore(file,destination,secret){
 if(fs.existsSync(destination))throw new Error('Восстановление разрешено только в новый каталог.');
 const data=fs.readFileSync(file),decipher=crypto.createDecipheriv('aes-256-gcm',key(secret),data.subarray(0,12));decipher.setAuthTag(data.subarray(12,28));
 const snapshot=JSON.parse(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8'));
 if(snapshot.version!==1||!snapshot.files||Array.isArray(snapshot.files))throw new Error('Неверный формат копии.');
 for(const [name,text]of Object.entries(snapshot.files)){if(!/^[a-zA-Z0-9_-]+\.json$/.test(name))throw new Error('Неверное имя файла.');JSON.parse(text);}
 fs.mkdirSync(destination,{recursive:true});
 for(const [name,text]of Object.entries(snapshot.files)){
  let value=JSON.parse(text);
  if(name==='sessions.json')value={};
  if(name==='email-accounts.json')value=value.map(a=>({...a,enabled:false}));
  if(name==='sequences.json')for(const run of value.runs||[])if(['active','sending'].includes(run.status)){run.status='paused';run.error='Восстановлено из копии: перед продолжением проверьте отправленные письма.';run.uncertain=true;}
  fs.writeFileSync(path.join(destination,name),JSON.stringify(value),{mode:0o600});
 }
}
function startBackups(dbDir){
 const state={lastSuccess:null,error:null};
 const run=()=>{try{backup(dbDir,process.env.OTKLIK_BACKUP_DIR||path.join(path.dirname(dbDir),'backups'),process.env.MAIL_TOKEN_KEY);state.lastSuccess=new Date().toISOString();state.error=null;}catch{state.error='Резервная копия не создана: проверьте ключ и доступ к каталогу.';console.error(state.error);}};
 run();const timer=setInterval(run,86400000);timer.unref();return {state,stop:()=>clearInterval(timer)};
}
if(require.main===module){
 const env=path.join(__dirname,'.env');if(fs.existsSync(env))process.loadEnvFile(env);
 try{if(process.argv[2]==='restore'){restore(process.argv[3],process.argv[4],process.env.MAIL_TOKEN_KEY);console.log('Копия восстановлена. Отправки выключены.');}else console.log(backup(process.env.OTKLIK_DATA_DIR||path.join(__dirname,'database'),process.env.OTKLIK_BACKUP_DIR||path.join(__dirname,'backups'),process.env.MAIL_TOKEN_KEY));}catch(e){console.error(e.message);process.exitCode=1;}
}
module.exports={backup,restore,startBackups};
