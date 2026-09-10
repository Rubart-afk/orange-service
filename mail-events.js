const header=(payload,name)=>(payload?.headers||[]).find(h=>h.name.toLowerCase()===name.toLowerCase())?.value||'';
function parts(payload){return [payload,...(payload?.parts||[]).flatMap(parts)].filter(Boolean);}
function classify(message,{to,since,messageIds}){
 if(message.labelIds?.some(x=>['SENT','DRAFT'].includes(x)))return null;
 if(!Number.isFinite(Number(message.internalDate)))throw new Error('Не получена дата входящего письма.');
 if(Number(message.internalDate)<since)return null;
 const from=header(message.payload,'From'),address=(from.match(/<([^<>]+)>\s*$/)?.[1]||from).trim().toLowerCase();
 if(address===to.toLowerCase())return {type:'replied',id:message.id};
 const all=parts(message.payload);
 const reports=all.filter(p=>p.mimeType?.toLowerCase()==='message/delivery-status');
 if(!reports.length)return null;
 // Require the original Message-ID as well as an exact failed recipient.
 const evidence=all.map(p=>header(p,'Message-ID')+'\n'+header(p,'In-Reply-To')+'\n'+header(p,'References')+'\n'+Buffer.from(p.body?.data||'','base64url').toString('utf8')).join('\n');
 if(!messageIds.some(id=>id&&evidence.includes(id)))return null;
 for(const report of reports){
  if(report.body?.attachmentId&&!report.body.data)throw new Error('Отчёт доставки требует дополнительной загрузки.');
  const body=Buffer.from(report.body?.data||'','base64url').toString('utf8').replace(/\r\n/g,'\n').replace(/\n[ \t]+/g,' ');
  for(const block of body.split(/\n\s*\n/)){
   const fields=Object.fromEntries(block.split('\n').filter(x=>x.includes(':')).map(line=>{const i=line.indexOf(':');return [line.slice(0,i).toLowerCase(),line.slice(i+1).trim()];}));
   const recipient=(fields['final-recipient']||'').split(';').slice(1).join(';').trim().toLowerCase();
   if(recipient!==to.toLowerCase())continue;
   if(fields.action?.toLowerCase()==='failed'&&/^5\.\d+\.\d+$/.test(fields.status||''))return {type:'bounced',id:message.id};
   if(fields.action?.toLowerCase()==='delayed')return {type:'delayed',id:message.id};
  }
 }
 return null;
}
async function scan(get,{to,since,messageIds}){
 let pageToken,count=0;const events=[],deadline=Date.now()+45000;
 do{
  const q=new URLSearchParams({q:`after:${Math.floor(since/1000)-1} -in:sent -in:drafts`,includeSpamTrash:'true',maxResults:'100'});if(pageToken)q.set('pageToken',pageToken);
  const page=await get('messages?'+q);
  for(const item of page.messages||[]){
   if(++count>500||Date.now()>deadline)throw new Error('Проверка входящих не завершена в отведённый срок; отправка приостановлена.');
   const message=await get('messages/'+encodeURIComponent(item.id)+'?format=full');
   for(const part of parts(message.payload))if(['message/delivery-status','text/rfc822-headers'].includes(part.mimeType?.toLowerCase())&&part.body?.attachmentId){
    if(part.body.size>262144)throw new Error('Слишком большой отчёт доставки: нужна ручная проверка.');
    const attachment=await get('messages/'+encodeURIComponent(item.id)+'/attachments/'+encodeURIComponent(part.body.attachmentId));part.body.data=attachment.data;
   }
   const event=classify(message,{to,since,messageIds});if(event)events.push(event);
  }
  pageToken=page.nextPageToken;
 }while(pageToken);
 return events.find(x=>x.type==='bounced')||events.find(x=>x.type==='replied')||events[0]||null;
}
module.exports={classify,scan,header};
