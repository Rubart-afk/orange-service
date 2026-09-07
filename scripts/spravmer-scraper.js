const https = require('https');
const fs = require('fs');
const path = require('path');

const CITIES = [
  'moskva', 'sankt-peterburg', 'samara', 'omsk', 'barnaul', 'krasnodar',
  'vladivostok', 'orenburg', 'krasnoyarsk', 'sochi', 'chelyabinsk',
  'voronezh', 'simferopol', 'kaliningrad', 'lipeck', 'perm', 'saratov',
  'ekaterinburg', 'ivanovo', 'kurgan', 'astrahan', 'ryazan', 'tyumen',
  'rostov-na-donu', 'novosibirsk', 'kazan', 'ufa', 'nizhnij-novgorod',
  'volgograd', 'kemerovo', 'tula', 'tver', 'habarovsk', 'murmansk',
  'smolensk', 'penza', 'kirov', 'kursk', 'stavropol', 'ulyanovsk',
  'vladimir', 'surgut', 'korolyov', 'velikij-novgorod'
];

const DELAY = 1200;
const DB_PATH = path.join(__dirname, '..', 'database', 'companies-spravmer.json');

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
        const loc = res.headers.location.startsWith('http') ? res.headers.location : `https://${new URL(url).hostname}${res.headers.location}`;
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

function parseListingPage(html, city) {
  const companies = [];
  const items = html.split('<li class="c-list-items__item">').slice(1);

  for (const item of items) {
    const nameMatch = item.match(/<a\s+class="c-list-items__name"[^>]*href="\/\/[^"]*spravmer\.ru\/([^"\/]+)\/"[^>]*>\s*([^<]+?)\s*<\/a>/i);
    if (!nameMatch) continue;

    const slug = nameMatch[1];
    const name = nameMatch[2].trim();

    const textBlock = item.match(/<div class="c-list-items__text">([\s\S]*?)<\/div>/i);
    const text = textBlock ? textBlock[1] : '';

    let phone = '';
    const phoneMatch = text.match(/Телефон[ыи]?:?\s*([^\n<]+)/i);
    if (phoneMatch) {
      phone = phoneMatch[1].replace(/<[^>]+>/g, '').replace(/[^\d+()\- ,]/g, '').trim();
    }

    let address = '';
    const addrMatch = text.match(/Адрес:\s*([^Т<]+)/i);
    if (addrMatch) {
      address = addrMatch[1].replace(/<[^>]+>/g, '').trim();
    }

    let categories = '';
    const catBlock = item.match(/<div class="c-list-items__categories">([\s\S]*?)<\/div>/i);
    if (catBlock) {
      const cats = [...catBlock[1].matchAll(/<i class="fa fa-chevron-right"><\/i>([^<]+)/g)];
      categories = cats.map(c => c[1].trim()).join(', ');
    }

    companies.push({ name, slug, phone, address, categories });
  }

  return companies;
}

function parseProfilePage(html) {
  const result = { website: '', phone: '' };

  const phoneMatch = html.match(/Телефон[ыи]?:?\s*([^\n<]+)/i);
  if (phoneMatch) {
    result.phone = phoneMatch[1].replace(/<[^>]+>/g, '').replace(/[^\d+()\- ,]/g, '').trim();
  }

  const websiteMatch = html.match(/Вебсайт:\s*<a[^>]*href="([^"]+)"/i) ||
                       html.match(/Вебсайт:\s*([^\s<]+)/i);
  if (websiteMatch) {
    result.website = websiteMatch[1].trim();
  }

  return result;
}

function getMaxPage(html) {
  const pageMatch = html.match(/\?page=(\d+)/g);
  if (pageMatch) {
    const pages = pageMatch.map(p => parseInt(p.replace('?page=', '')));
    return Math.max(...pages);
  }
  return 1;
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'listings';
  const startIdx = parseInt(args[1]) || 0;
  const maxCities = parseInt(args[2]) || CITIES.length;

  console.log('=== Spravmer.ru Scraper v3 ===');
  console.log(`Mode: ${mode}`);

  let db = { companies: [], metadata: {} };
  try {
    db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    console.log(`Existing: ${db.companies.length} companies`);
  } catch { console.log('Starting fresh'); }

  if (mode === 'profiles') {
    const needProfile = db.companies.filter(c => !c.website);
    console.log(`Need profiles: ${needProfile.length}`);
    let updated = 0;

    for (let i = 0; i < needProfile.length; i++) {
      const c = needProfile[i];
      try {
        const url = `https://${c.city}.spravmer.ru/${c.slug}/`;
        const html = await fetch(url);
        const profile = parseProfilePage(html);

        if (profile.website && !c.website) {
          c.website = profile.website;
          updated++;
        }
        if (profile.phone && !c.phone) {
          c.phone = profile.phone;
        }

        if ((i + 1) % 50 === 0) {
          console.log(`[${i + 1}/${needProfile.length}] +${updated} websites`);
          saveDb(db);
        }
      } catch (e) {
        if (e.message === 'timeout') await sleep(3000);
      }
      await sleep(DELAY);
    }

    saveDb(db);
    console.log(`\nDone. Updated: ${updated}`);
    console.log(`With website: ${db.companies.filter(c => c.website).length}`);
    console.log(`With phone: ${db.companies.filter(c => c.phone).length}`);
    return;
  }

  const cities = CITIES.slice(startIdx, startIdx + maxCities);
  console.log(`Cities: ${cities.length}\n`);

  for (const city of cities) {
    console.log(`--- ${city} ---`);

    let firstHtml;
    try {
      firstHtml = await fetch(`https://${city}.spravmer.ru/all/`);
    } catch (e) {
      console.error(`  Error: ${e.message}`);
      continue;
    }

    const maxPage = getMaxPage(firstHtml);
    const totalMatch = firstHtml.match(/Всего\s+([\d]+)\s+компани/i);
    const total = totalMatch ? totalMatch[1] : '?';
    console.log(`  Total: ${total}, Pages: ${maxPage}`);

    const firstCompanies = parseListingPage(firstHtml, city);
    let added = 0;
    for (const c of firstCompanies) {
      const key = `${c.name}|${city}`;
      if (!db.companies.find(ec => `${ec.name}|${ec.city}` === key)) {
        db.companies.push({
          id: `spr-${String(db.companies.length + 1).padStart(6, '0')}`,
          name: c.name,
          slug: c.slug,
          city,
          categories: c.categories,
          address: c.address,
          phone: c.phone,
          email: '',
          website: '',
          inn: '',
          legal_name: '',
          source: 'spravmer.ru',
          source_url: `https://${city}.spravmer.ru/${c.slug}/`
        });
        added++;
      }
    }
    console.log(`  Page 1: +${added}`);

    for (let page = 2; page <= maxPage; page++) {
      await sleep(DELAY);
      try {
        const url = `https://${city}.spravmer.ru/all/?page=${page}`;
        const html = await fetch(url);
        const pageCompanies = parseListingPage(html, city);

        let pageAdded = 0;
        for (const c of pageCompanies) {
          const key = `${c.name}|${city}`;
          if (!db.companies.find(ec => `${ec.name}|${ec.city}` === key)) {
            db.companies.push({
              id: `spr-${String(db.companies.length + 1).padStart(6, '0')}`,
              name: c.name,
              slug: c.slug,
              city,
              categories: c.categories,
              address: c.address,
              phone: c.phone,
              email: '',
              website: '',
              inn: '',
              legal_name: '',
              source: 'spravmer.ru',
              source_url: `https://${city}.spravmer.ru/${c.slug}/`
            });
            pageAdded++;
          }
        }

        if (page % 20 === 0 || page === maxPage) {
          console.log(`  Page ${page}/${maxPage}: +${pageAdded} (total: ${db.companies.length})`);
          saveDb(db);
        }
      } catch (e) {
        console.error(`  Error page ${page}: ${e.message}`);
        if (e.message === 'timeout') await sleep(5000);
      }
    }

    saveDb(db);
    console.log(`  Done. Total: ${db.companies.length}\n`);
  }

  console.log(`=== FINAL ===`);
  console.log(`Total: ${db.companies.length}`);
  console.log(`With phone: ${db.companies.filter(c => c.phone).length}`);
}

main().catch(console.error);
