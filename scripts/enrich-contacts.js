const https = require('https');
const fs = require('fs');
const path = require('path');

const DELAY = 2000;
const SAVE_EVERY = 100;
const DB_PATH = path.join(__dirname, '..', 'database', 'companies.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetch(url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout')), 25000);
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'ru-RU,ru;q=0.9'
      }
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        clearTimeout(timeout);
        const loc = res.headers.location.startsWith('http') ? res.headers.location : `https://xn--h1aafjhelcc6a.xn--p1ai${res.headers.location}`;
        fetch(loc).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { clearTimeout(timeout); resolve(data); });
      res.on('error', e => { clearTimeout(timeout); reject(e); });
    });
    req.on('error', e => { clearTimeout(timeout); reject(e); });
    req.end();
  });
}

function extractContact(html) {
  const r = { phone: '', email: '', website: '', inn: '', legal_name: '', address: '' };

  const pm = html.match(/tel:([^\s"<]+)/i) || html.match(/\+7[\s\(][\d\s\(\)\-]{10,18}/);
  if (pm) r.phone = (pm[1] || pm[0]).replace(/[^\d+()\- ]/g, '').trim();

  const em = html.match(/mailto:([^\s"<]+)/i) || html.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/);
  if (em) r.email = (em[1] || em[0]).trim();

  const inn = html.match(/ИНН[:\s]*(\d{10,12})/i);
  if (inn) r.inn = inn[1];

  const ws = html.match(/Сайт[^<]*<[^>]*href="(https?:\/\/[^"]+)"/i) ||
             html.match(/class="[^"]*website[^"]*"[^>]*href="(https?:\/\/[^"]+)"/i);
  if (ws) r.website = ws[1];

  const ln = html.match(/(ООО|ИП|АО|ПАО|ЗАО)\s*[«"]([^»"]+)[»"]/);
  if (ln) r.legal_name = `${ln[1]} "${ln[2]}"`;

  const ad = html.match(/(\d{6}[^<]{10,150})/);
  if (ad) r.address = ad[1].trim();

  return r;
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

async function main() {
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  const companies = db.companies;

  const needContact = companies.filter(c => !c.phone && !c.email);
  const alreadyDone = companies.length - needContact.length;

  console.log(`Total: ${companies.length}`);
  console.log(`Already have contacts: ${alreadyDone}`);
  console.log(`Need contacts: ${needContact.length}`);
  console.log(`Will save every ${SAVE_EVERY} companies\n`);

  let updated = 0;
  let errors = 0;

  for (let i = 0; i < needContact.length; i++) {
    const c = needContact[i];
    const slug = c.source_url ? c.source_url.split('/companies/')[1]?.split('?')[0] : null;
    if (!slug) { errors++; continue; }

    const url = `https://xn--h1aafjhelcc6a.xn--p1ai/companies/${slug}`;

    try {
      const html = await fetch(url);
      const contact = extractContact(html);

      if (contact.phone) { c.phone = contact.phone; updated++; }
      if (contact.email) c.email = contact.email;
      if (contact.website) c.website = contact.website;
      if (contact.inn) c.inn = contact.inn;
      if (contact.legal_name) c.legal_name = contact.legal_name;
      if (contact.address) c.address = contact.address;
    } catch (e) {
      errors++;
    }

    if ((i + 1) % SAVE_EVERY === 0) {
      saveDb(db);
      console.log(`[${i + 1}/${needContact.length}] +${updated} phones, ${errors} errors — SAVED`);
    }

    await sleep(DELAY);
  }

  saveDb(db);

  console.log(`\n=== DONE ===`);
  console.log(`Updated: ${updated}`);
  console.log(`Errors: ${errors}`);
  console.log(`With phone: ${companies.filter(c => c.phone).length}`);
  console.log(`With email: ${companies.filter(c => c.email).length}`);
}

main().catch(console.error);
