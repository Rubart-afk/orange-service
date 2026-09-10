const https = require('https');
const fs = require('fs');
const path = require('path');

const CITIES_URAL = [
  'moskva', 'sankt-peterburg', 'nizhnij-novgorod', 'kazan', 'samara',
  'ufa', 'perm', 'voronezh', 'volgograd', 'saratov',
  'ryazan', 'tula', 'yaroslavl', 'tver', 'kirov',
  'penza', 'kursk', 'smolensk', 'kaluga',
  'vladimir', 'ivanovo', 'kostroma', 'vologda', 'velikij-novgorod',
  'pskov', 'arkhangelsk', 'murmansk', 'orenburg', 'barnaul',
  'tomsk', 'kemerovo', 'orenburg'
];

const DELAY = 1000;
const SAVE_DIR = path.join(__dirname, '..', 'database', 'spravmer-html');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetch(url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout')), 30000);
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ru-RU,ru;q=0.9'
      }
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        clearTimeout(timeout);
        const loc = res.headers.location.startsWith('http') ? res.headers.location : `https://${new URL(url).hostname}${res.headers.location}`;
        fetch(loc).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode === 404) {
        clearTimeout(timeout);
        reject(new Error('404'));
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

function getMaxPage(html) {
  const pageMatch = html.match(/\?page=(\d+)/g);
  if (pageMatch) {
    const pages = pageMatch.map(p => parseInt(p.replace('?page=', '')));
    return Math.max(...pages);
  }
  return 1;
}

function getTotalCompanies(html) {
  const m = html.match(/Всего\s+([\d\s]+)\s+компани/i);
  return m ? m[1].replace(/\s/g, '') : '?';
}

async function main() {
  const args = process.argv.slice(2);
  const startIdx = parseInt(args[0]) || 0;
  const maxCities = parseInt(args[1]) || CITIES_URAL.length;

  console.log('=== Spravmer.ru HTML Downloader ===');
  console.log(`Cities: ${CITIES_URAL.length}, Starting from: ${startIdx}`);

  if (!fs.existsSync(SAVE_DIR)) fs.mkdirSync(SAVE_DIR, { recursive: true });

  const cities = CITIES_URAL.slice(startIdx, startIdx + maxCities);
  let totalPages = 0;

  for (const city of cities) {
    console.log(`\n--- ${city} ---`);
    const cityDir = path.join(SAVE_DIR, city);
    if (!fs.existsSync(cityDir)) fs.mkdirSync(cityDir, { recursive: true });

    let firstHtml;
    try {
      firstHtml = await fetch(`https://${city}.spravmer.ru/all/`);
    } catch (e) {
      console.error(`  SKIP ${city}: ${e.message}`);
      continue;
    }

    const maxPage = getMaxPage(firstHtml);
    const total = getTotalCompanies(firstHtml);
    console.log(`  Total: ${total} companies, Pages: ${maxPage}`);

    fs.writeFileSync(path.join(cityDir, 'page_1.html'), firstHtml, 'utf8');
    totalPages++;

    for (let page = 2; page <= maxPage; page++) {
      const pageFile = path.join(cityDir, `page_${page}.html`);
      if (fs.existsSync(pageFile)) {
        totalPages++;
        continue;
      }
      await sleep(DELAY);
      try {
        const url = `https://${city}.spravmer.ru/all/?page=${page}`;
        const html = await fetch(url);
        fs.writeFileSync(pageFile, html, 'utf8');
        totalPages++;

        if (page % 50 === 0) {
          console.log(`  ${city}: page ${page}/${maxPage} (${totalPages} total)`);
        }
      } catch (e) {
        if (e.message === '404') {
          console.log(`  ${city}: page ${page} = 404, stopping`);
          break;
        }
        console.error(`  Error page ${page}: ${e.message}`);
        if (e.message === 'timeout') await sleep(5000);
      }
    }

    console.log(`  ${city}: done (${maxPage} pages)`);
  }

  console.log(`\n=== DONE ===`);
  console.log(`Total pages downloaded: ${totalPages}`);
  console.log(`Saved to: ${SAVE_DIR}`);
}

main().catch(console.error);
