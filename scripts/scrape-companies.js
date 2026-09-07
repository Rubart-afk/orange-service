const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://xn--h1aafjhelcc6a.xn--p1ai/companies';
const CITIES = [
  { id: 1, name: 'Москва', region: 'Москва' },
  { id: 5, name: 'Санкт-Петербург', region: 'Санкт-Петербург' },
  { id: 6, name: 'Екатеринбург', region: 'Свердловская область' },
  { id: 7, name: 'Воронеж', region: 'Воронежская область' },
  { id: 8, name: 'Хабаровск', region: 'Хабаровский край' },
  { id: 10, name: 'Челябинск', region: 'Челябинская область' },
  { id: 11, name: 'Пермь', region: 'Пермский край' },
  { id: 12, name: 'Новосибирск', region: 'Новосибирская область' },
  { id: 13, name: 'Казань', region: 'Республика Татарстан' },
  { id: 14, name: 'Нижний Новгород', region: 'Нижегородская область' },
  { id: 15, name: 'Краснодар', region: 'Краснодарский край' },
  { id: 16, name: 'Самара', region: 'Самарская область' },
  { id: 17, name: 'Уфа', region: 'Республика Башкортостан' },
  { id: 19, name: 'Ростов-на-Дону', region: 'Ростовская область' },
  { id: 20, name: 'Волгоград', region: 'Волгоградская область' },
  { id: 21, name: 'Красноярск', region: 'Красноярский край' },
  { id: 22, name: 'Саратов', region: 'Саратовская область' },
  { id: 23, name: 'Тюмень', region: 'Тюменская область' },
  { id: 24, name: 'Тольятти', region: 'Самарская область' },
  { id: 25, name: 'Ижевск', region: 'Удмуртская Республика' },
  { id: 26, name: 'Барнаул', region: 'Алтайский край' },
  { id: 27, name: 'Иркутск', region: 'Иркутская область' },
  { id: 29, name: 'Ярославль', region: 'Ярославская область' },
  { id: 30, name: 'Владивосток', region: 'Приморский край' },
  { id: 32, name: 'Томск', region: 'Томская область' },
  { id: 33, name: 'Оренбург', region: 'Оренбургская область' },
  { id: 34, name: 'Кемерово', region: 'Кемеровская область' },
  { id: 36, name: 'Рязань', region: 'Рязанская область' },
  { id: 38, name: 'Астрахань', region: 'Астраханская область' },
  { id: 39, name: 'Пенза', region: 'Пензенская область' },
  { id: 40, name: 'Киров', region: 'Кировская область' },
  { id: 41, name: 'Липецк', region: 'Липецкая область' },
  { id: 43, name: 'Калининград', region: 'Калининградская область' },
  { id: 44, name: 'Тула', region: 'Тульская область' },
  { id: 45, name: 'Сочи', region: 'Краснодарский край' },
  { id: 46, name: 'Курск', region: 'Курская область' },
  { id: 47, name: 'Ставрополь', region: 'Ставропольский край' },
  { id: 48, name: 'Ульяновск', region: 'Ульяновская область' },
  { id: 50, name: 'Владимир', region: 'Владимирская область' },
  { id: 51, name: 'Сургут', region: 'Ханты-Мансийский АО' },
  { id: 57, name: 'Тверь', region: 'Тверская область' },
  { id: 63, name: 'Мурманск', region: 'Мурманская область' },
  { id: 66, name: 'Смоленск', region: 'Смоленская область' },
  { id: 69, name: 'Королёв', region: 'Московская область' },
  { id: 72, name: 'Великий Новгород', region: 'Новгородская область' },
  { id: 73, name: 'Курган', region: 'Курганская область' },
];

const DELAY_MS = 1500;
const LISTING_DELAY_MS = 1200;
const MAX_PAGES_PER_CITY = 999;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetch(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const timeout = setTimeout(() => reject(new Error('Timeout')), 20000);
    client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        clearTimeout(timeout);
        fetch(res.headers.location).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { clearTimeout(timeout); resolve(data); });
      res.on('error', (err) => { clearTimeout(timeout); reject(err); });
    }).on('error', (err) => { clearTimeout(timeout); reject(err); });
  });
}

function parseListing(html, city, region) {
  const companies = [];
  const seen = new Set();

  const slugRegex = /href="\/companies\/([^"]+)"/g;
  let match;
  while ((match = slugRegex.exec(html)) !== null) {
    const slug = match[1];
    if (slug && slug !== 'new' && slug !== 'spisokfirm' && !slug.startsWith('?') && !slug.includes('/')) {
      seen.add(slug);
    }
  }

  for (const slug of seen) {
    const nameRegex = new RegExp(
      `href="/companies/${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>\\s*(?:<[^>]*>)*\\s*([^<]{3,100})`,
      'i'
    );
    const nameMatch = html.match(nameRegex);
    let name = nameMatch ? nameMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    if (!name || name.length < 2) {
      name = slug.split('-').filter(p => p.length > 1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
    }

    const descRegex = new RegExp(
      `href="/companies/${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]{0,500}?(?:<p[^>]*>|<span[^>]*>)\\s*([\\s\\S]{10,300}?)\\s*<\\/`,
      'i'
    );
    const descMatch = html.match(descRegex);
    const description = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    const industryKeywords = {
      'Строительство': ['строит', 'ремонт', 'монтаж', 'отделк', 'фасад', 'кровл', 'плитк', 'бетон', 'окон', 'двер'],
      'Торговля': ['торговл', 'магазин', 'продаж', 'поставщик', 'интернет-магазин', 'розниц', 'опт', 'склад'],
      'Промышленность и производство': ['производств', 'завод', 'фабрик', 'изготовлен', 'выпуск', 'переработк'],
      'Услуги': ['услуг', 'сервис', 'обслужив', 'консалт', 'юридич', 'бухгалтер', 'оценк', 'эксперт'],
      'Здоровье и медицина': ['медицин', 'клиник', 'больниц', 'врач', 'здоровь', 'диагност', 'стоматолог'],
      'Образование': ['обучен', 'школ', 'образован', 'курс', 'тренер', 'институт', 'академ'],
      'Логистика': ['логистик', 'доставк', 'перевозк', 'транспорт', 'груз', 'экспедир'],
      'Реклама': ['реклам', 'маркетинг', 'продвижен', 'маркетплейс', 'SMM', 'SEO', 'PR'],
      'IT и разработка': ['IT', 'программ', 'разработк', 'сайт', 'цифров', 'софт', 'приложен'],
      'Продукты питания': ['кондитер', 'хлеб', 'пищев', 'продукт', 'питан', 'мяс', 'молоч', 'ресторан', 'кафе'],
      'Оборудование': ['оборудован', 'техник', 'инструмент', 'станок', 'маши', 'механизм'],
      'Недвижимость': ['недвижим', 'квартир', 'дом', 'офис', 'аренд', 'риэлт'],
      'Бизнес, финансы и страхование': ['финанс', 'бухгалтер', 'налог', 'банков', 'страхов', 'кредит', 'инвест'],
      'Досуг и развлечения': ['отдых', 'развлечен', 'спорт', 'фитнес', 'клуб', 'отель', 'гостиниц', 'туризм'],
      'Авто-мото': ['авто', 'машин', 'транспорт', 'запчаст', 'эвакуатор', 'шиномонтаж'],
      'Безопасность': ['охран', 'безопасност', 'видеонаблюд', 'пожарн'],
      'СМИ': ['журнал', 'газет', 'СМИ', 'издатель', 'median'],
    };

    let industry = 'Другое';
    const descLower = (name + ' ' + description).toLowerCase();
    for (const [ind, keywords] of Object.entries(industryKeywords)) {
      if (keywords.some(kw => descLower.includes(kw.toLowerCase()))) {
        industry = ind;
        break;
      }
    }

    companies.push({ name, slug, description, industry, city, region });
  }

  return companies;
}

function getMaxPage(html) {
  const pageMatches = html.match(/[?&]page=(\d+)/g);
  if (pageMatches) {
    const pages = pageMatches.map(m => parseInt(m.match(/=(\d+)/)[1]));
    return Math.max(...pages);
  }
  return 1;
}

function parseContactPage(html) {
  const contact = { phone: '', email: '', website: '', inn: '', legal_name: '', address: '' };

  const phoneMatch = html.match(/(?:tel:|href="tel:)([^"'\s<]+)/i) ||
                     html.match(/\+7\s*[\(\d]{2,3}\)[\s-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/);
  if (phoneMatch) {
    contact.phone = (phoneMatch[1] || phoneMatch[0]).replace(/[^\d+()\- ]/g, '').trim();
  }

  const emailMatch = html.match(/(?:mailto:|href="mailto:)([^"'\s<]+)/i) ||
                     html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) {
    contact.email = (emailMatch[1] || emailMatch[0]).trim();
  }

  const websiteMatch = html.match(/(?:Официальный сайт|Сайт|website)[^<]*<[^>]*href="((?!\/companies|\/articles|\/catalog|\/categories|\/cities|\/auth|\/about|\/contacts|\/faq|\/news|\/top|\/okved|\/preimushchestva|\/tseny|\/razmeshchenie)[^"]+)"/i) ||
                       html.match(/class="[^"]*website[^"]*"[^>]*href="([^"]+)"/i);
  if (websiteMatch) {
    contact.website = websiteMatch[1].trim();
  }

  const innMatch = html.match(/ИНН\s*[:\s]*(\d{10,12})/i);
  if (innMatch) {
    contact.inn = innMatch[1];
  }

  const legalMatch = html.match(/Юридическое название[^<]*<[^>]*>([^<]+)/i) ||
                     html.match(/Юр\.?\s*название[^<]*<[^>]*>([^<]+)/i) ||
                     html.match(/(ООО|ИП|АО|ПАО|ЗАО)\s*[«"]([^»"]+)[»"]/);
  if (legalMatch) {
    contact.legal_name = (legalMatch[1] || '').trim() + ' ' + (legalMatch[2] || '').trim();
  }

  const addrMatch = html.match(/(?:Юридический адрес|Адрес)[^<]*<[^>]*>\s*([^\s<].{10,200}?)(?:<|$)/i) ||
                    html.match(/(\d{6}[^<]{10,150})/);
  if (addrMatch) {
    contact.address = addrMatch[1].replace(/<[^>]+>/g, '').trim();
  }

  return contact;
}

async function scrapeCity(city, maxPages) {
  const companies = [];
  let totalPages = 1;

  try {
    const firstUrl = `${BASE_URL}?city_ids=${city.id}&page=1`;
    const firstHtml = await fetch(firstUrl);
    totalPages = Math.min(getMaxPage(firstHtml), maxPages);

    const firstCompanies = parseListing(firstHtml, city.name, city.region);
    companies.push(...firstCompanies);

    for (let page = 2; page <= totalPages; page++) {
      await sleep(LISTING_DELAY_MS);
      try {
        const url = `${BASE_URL}?city_ids=${city.id}&page=${page}`;
        const html = await fetch(url);
        const pageCompanies = parseListing(html, city.name, city.region);
        companies.push(...pageCompanies);
        if (page % 20 === 0) {
          console.log(`    Page ${page}/${totalPages}: ${companies.length} found`);
        }
      } catch (err) {
        console.error(`    Error page ${page}: ${err.message}`);
      }
    }
  } catch (error) {
    console.error(`  Error listing ${city.name}:`, error.message);
  }

  return companies;
}

async function enrichContacts(companies, batchSize = 5) {
  let updated = 0;
  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    if (company.phone && company.email) continue;

    try {
      const url = `https://xn--h1aafjhelcc6a.xn--p1ai/companies/${company.slug || company.source_url?.split('/companies/')[1]}`;
      if (!url.includes('/companies/') || url.endsWith('/companies/')) continue;

      const html = await fetch(url);
      const contact = parseContactPage(html);

      if (contact.phone && !company.phone) { company.phone = contact.phone; updated++; }
      if (contact.email && !company.email) { company.email = contact.email; updated++; }
      if (contact.website && !company.website) { company.website = contact.website; }
      if (contact.inn && !company.inn) { company.inn = contact.inn; }
      if (contact.legal_name && !company.legal_name) { company.legal_name = contact.legal_name; }
      if (contact.address && !company.address) { company.address = contact.address; }

      await sleep(DELAY_MS);

      if ((i + 1) % 10 === 0) {
        console.log(`    Enriched ${i + 1}/${companies.length} (+${updated} phones/emails)`);
      }
    } catch (err) {
      // skip
    }
  }
  return updated;
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'all';

  console.log('=== Company Scraper ===');
  console.log(`Mode: ${mode}`);

  const existingPath = path.join(__dirname, '..', 'database', 'companies.json');
  let existingCompanies = [];
  try {
    const existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
    existingCompanies = existing.companies || [];
    console.log(`Existing: ${existingCompanies.length} companies`);
  } catch (e) {
    console.log('Starting fresh');
  }

  if (mode === 'contacts' || mode === 'enrich') {
    console.log('\n--- Enriching existing companies with contacts ---');
    const withoutPhone = existingCompanies.filter(c => !c.phone).length;
    const withoutEmail = existingCompanies.filter(c => !c.email).length;
    console.log(`Without phone: ${withoutPhone}`);
    console.log(`Without email: ${withoutEmail}`);

    const updated = await enrichContacts(existingCompanies);
    console.log(`\nUpdated ${updated} companies`);

    const output = {
      companies: existingCompanies,
      metadata: {
        source: 'списокфирм.рф',
        total_companies: existingCompanies.length,
        total_regions: [...new Set(existingCompanies.map(c => c.region))].length,
        total_cities: [...new Set(existingCompanies.map(c => c.city))].length,
        scraped_at: new Date().toISOString(),
        note: 'Автоматически собранная база компаний с контактами для холодных рассылок'
      }
    };
    fs.writeFileSync(existingPath, JSON.stringify(output, null, 2), 'utf8');
    console.log(`Saved to: ${existingPath}`);

    const withPhone = existingCompanies.filter(c => c.phone).length;
    const withEmail = existingCompanies.filter(c => c.email).length;
    const withWebsite = existingCompanies.filter(c => c.website).length;
    console.log(`\nFinal stats:`);
    console.log(`  With phone: ${withPhone}`);
    console.log(`  With email: ${withEmail}`);
    console.log(`  With website: ${withWebsite}`);
    return;
  }

  const startCity = parseInt(args[0]) || 0;
  const maxCities = parseInt(args[1]) || CITIES.length;
  const citiesToScrape = CITIES.slice(startCity, startCity + maxCities);

  console.log(`\n--- Scraping ${citiesToScrape.length} cities ---`);

  for (const city of citiesToScrape) {
    console.log(`\n${city.name} (${city.region})...`);
    const cityCompanies = await scrapeCity(city, MAX_PAGES_PER_CITY);
    console.log(`  Found ${cityCompanies.length} companies, fetching contacts...`);

    await enrichContacts(cityCompanies);

    for (const c of cityCompanies) {
      const key = c.name + '|' + c.city;
      const exists = existingCompanies.find(ec => (ec.name + '|' + ec.city) === key);
      if (!exists) {
        existingCompanies.push({
          id: `comp-${String(existingCompanies.length + 1).padStart(5, '0')}`,
          name: c.name,
          legal_name: c.legal_name || '',
          region: c.region,
          city: c.city,
          industry: c.industry,
          description: c.description,
          address: c.address || '',
          phone: c.phone || '',
          email: c.email || '',
          website: c.website || '',
          inn: c.inn || '',
          status: 'Действующая',
          source_url: `https://списокфирм.рф/companies/${c.slug}`,
          coverage: c.city
        });
      }
    }
    console.log(`  Total unique: ${existingCompanies.length}`);

    const output = {
      companies: existingCompanies,
      metadata: {
        source: 'списокфирм.рф',
        total_companies: existingCompanies.length,
        total_regions: [...new Set(existingCompanies.map(c => c.region))].length,
        total_cities: [...new Set(existingCompanies.map(c => c.city))].length,
        scraped_at: new Date().toISOString(),
        note: 'Автоматически собранная база компаний с контактами для холодных рассылок'
      }
    };
    fs.writeFileSync(existingPath, JSON.stringify(output, null, 2), 'utf8');
  }

  console.log(`\n=== Done! ===`);
  console.log(`Total: ${existingCompanies.length} companies`);
  const withPhone = existingCompanies.filter(c => c.phone).length;
  const withEmail = existingCompanies.filter(c => c.email).length;
  const withWebsite = existingCompanies.filter(c => c.website).length;
  console.log(`With phone: ${withPhone}`);
  console.log(`With email: ${withEmail}`);
  console.log(`With website: ${withWebsite}`);
}

main().catch(console.error);
