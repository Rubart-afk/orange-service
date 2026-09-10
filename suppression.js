const fs=require('node:fs');
const path=require('node:path');
function suppression(dbDir){
 const file=path.join(dbDir,'suppression.json');
 const read=()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];
 const normalize=email=>String(email).trim().toLowerCase();
 return {
  list:userId=>read().filter(x=>x.userId===userId),
  has:(userId,email)=>read().some(x=>x.userId===userId&&x.email===normalize(email)),
  add(userId,email,reason='manual_refusal'){const items=read(),value=normalize(email);if(!items.some(x=>x.userId===userId&&x.email===value)){items.push({userId,email:value,reason,createdAt:new Date().toISOString()});fs.writeFileSync(file+'.tmp',JSON.stringify(items,null,2));fs.renameSync(file+'.tmp',file);}}
 };
}
module.exports={suppression};
