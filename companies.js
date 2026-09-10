const fs=require('node:fs');const path=require('node:path');
const cities={moskva:'Москва','sankt-peterburg':'Санкт-Петербург',samara:'Самара',murmansk:'Мурманск'};
const clean=x=>typeof x==='string'?x.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').trim().slice(0,500):'';
const phoneText=x=>clean(x).split(/[,;]/).map(s=>s.trim()).filter(s=>!s.includes('\uFFFD')&&s.replace(/\D/g,'').length>=10&&s.replace(/\D/g,'').length<=15).join(', ');
function safeUrl(value){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}}
const sectors=[['Автомобили и обслуживание',/авто|шин|азс|мототех/i],['Медицина и здоровье',/медицин|стомат|аптек|клиник|больниц|поликлиник|оптик/i],['Образование',/обуч|образован|школ|курс|детский сад|университет|колледж/i],['Красота и спорт',/красот|парикмахер|фитнес|спортив|космет|маникюр|массаж/i],['Транспорт и логистика',/перевоз|логист|доставк|склад|транспорт|курьер/i],['Строительство и недвижимость',/строит|недвижим|ремонт|архитект|дизайн|сантех|электромонтаж/i],['IT и связь',/программ|компьютер|интернет|связ|телеком/i],['Промышленность',/производ|завод|промышлен|металл|оборудован|инструмент/i],['Питание и гостиницы',/ресторан|кафе|гостиниц|отел|пицц|столов|бар\b|туризм|турист/i],['Деловые услуги',/юрид|бухгалтер|консалт|реклам|полиграф|страхов|банк|нотариус|аудит/i],['Торговля',/магазин|торгов|товар|оптов|супермаркет|рынок/i]];
function sector(categories){return sectors.find(([,re])=>re.test(categories))?.[0]||'Другие услуги';}
function loadCompanies(dir){
 const read=(f,fallback)=>fs.existsSync(path.join(dir,f))?JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')):fallback;
 const official=read('companies-curated.json',[]).map(x=>({...x,website:safeUrl(x.website),source_url:safeUrl(x.source_url)}));
 const seen=new Set();let skipped=0;
 const legacy=[];
 for(const x of read('companies-spravmer.json',{companies:[]}).companies){
   const name=clean(x.name),city=cities[x.city],source_url=safeUrl(x.source_url),categories=clean(x.categories).split(',').map(s=>s.trim()).filter(s=>s&&!s.includes('\uFFFD'));
   if(!name||name.includes('\uFFFD')||!city||!source_url||!categories.length){skipped++;continue;}
   const key=source_url.replace(/\/$/,'');if(seen.has(key)){skipped++;continue;}seen.add(key);
   legacy.push({id:clean(x.id),name,city,industry:sector(categories.join(', ')),categories,phone:phoneText(x.phone),email:'',website:'',source_url,sourceType:'directory',checkedAt:null,description:'',contactNote:'Справочник spravmer.ru: актуальность и принадлежность телефона не проверены.'});
 }
 const enrichments=new Map(read('company-enrichments.json',[]).map(x=>[x.id,x]));
 const items=[...official,...legacy].map(company=>{
  const extra=enrichments.get(company.id);
  if(!extra||extra.name!==company.name||extra.city!==company.city)return company;
  const email=clean(extra.email),emailSourceUrl=safeUrl(extra.emailSourceUrl);
  if(!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)||!emailSourceUrl||!/^\d{4}-\d{2}-\d{2}$/.test(extra.emailCheckedAt||''))return company;
  return {...company,email,emailSourceUrl,emailCheckedAt:extra.emailCheckedAt,emailNote:clean(extra.emailNote),website:safeUrl(extra.website)||company.website};
 });
 items.sort((a,b)=>Number(Boolean(b.email))-Number(Boolean(a.email)));
 return {items,skipped};
}
function installCompanies(app,{dir=path.join(__dirname,'database'),dbDir=dir,requireUser,requireSubscription}={}){
 const {items,skipped}=loadCompanies(dir);
 const byId=new Map(items.map(x=>[x.id,x]));
 const selectedFile=path.join(dbDir,'selected-companies.json');
 const readSelected=()=>fs.existsSync(selectedFile)?JSON.parse(fs.readFileSync(selectedFile,'utf8')):[];
 const saveSelected=rows=>{fs.writeFileSync(selectedFile+'.tmp',JSON.stringify(rows,null,2));fs.renameSync(selectedFile+'.tmp',selectedFile);};
 const authorize=(req,res)=>requireUser?requireUser(req,res):requireSubscription?requireSubscription(req,res):(res.status(401).json({error:'Войдите в аккаунт.'}),null);
 const mine=userId=>readSelected().filter(x=>x.userId===userId).map(x=>({...x,company:byId.get(x.companyId)||{id:x.companyId,name:'Компания больше не представлена в каталоге',city:'',industry:''}}));
 app.get('/api/selected-companies',(req,res)=>{const u=authorize(req,res);if(u)res.json({companies:mine(u.id)});});
 app.post('/api/selected-companies',(req,res)=>{
  const u=authorize(req,res);if(!u)return;const ids=req.body?.ids;
  if(!Array.isArray(ids)||ids.length<1||ids.length>100||ids.some(id=>typeof id!=='string'||!byId.has(id)))return res.status(400).json({error:'Выберите от 1 до 100 компаний из каталога.'});
  const rows=readSelected();let added=0;
  for(const companyId of new Set(ids))if(!rows.some(x=>x.userId===u.id&&x.companyId===companyId)){rows.push({userId:u.id,companyId,enabled:false,addedAt:new Date().toISOString()});added++;}
  saveSelected(rows);res.json({added,companies:mine(u.id)});
 });
 app.patch('/api/selected-companies/:id',(req,res)=>{
  const u=authorize(req,res);if(!u)return;
  if(typeof req.body?.enabled!=='boolean')return res.status(400).json({error:'Укажите включение или выключение.'});
  const rows=readSelected(),entry=rows.find(x=>x.userId===u.id&&x.companyId===req.params.id);
  if(!entry)return res.status(404).json({error:'Компания не добавлена в ваш список.'});
  entry.enabled=req.body.enabled;saveSelected(rows);res.json({company:entry});
 });
 const values=key=>[...new Set(items.flatMap(x=>Array.isArray(x[key])?x[key]:[x[key]]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
 app.get('/api/companies/filters',(req,res)=>res.json({industries:values('industry'),categories:values('categories'),cities:values('city'),total:items.length,official:items.filter(x=>x.sourceType==='official').length,withEmail:items.filter(x=>x.email).length,skipped}));
 app.get('/api/companies',(req,res)=>{
  const scalar=(key)=>typeof req.query[key]==='string'?req.query[key].trim():'';
  const q=scalar('q').toLocaleLowerCase('ru').slice(0,100),industry=scalar('industry'),category=scalar('category'),city=scalar('city'),source=scalar('source'),contact=scalar('contact');
  const page=Math.max(1,Math.min(100000,Number.parseInt(scalar('page'),10)||1));const size=24;
  const found=items.filter(x=>(!q||[x.name,x.city,x.industry,...x.categories].join(' ').toLocaleLowerCase('ru').includes(q))&&(!industry||x.industry===industry)&&(!category||x.categories.includes(category))&&(!city||x.city===city)&&(!source||x.sourceType===source)&&(!['email','phone','website'].includes(contact)||Boolean(x[contact])));
  res.json({items:found.slice((page-1)*size,page*size),total:found.length,page,pages:Math.ceil(found.length/size),pageSize:size});
 });
 return {selectedFor:mine};
}
module.exports={installCompanies,loadCompanies,safeUrl,sector};
