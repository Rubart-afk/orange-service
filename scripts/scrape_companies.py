import urllib.request
import urllib.error
import json
import time
import re
import os

BASE_URL = 'https://xn--h1aafjhelcc6a.xn--p1ai/companies'

CITIES = [
    {"id": 1, "name": "Москва", "region": "Москва"},
    {"id": 5, "name": "Санкт-Петербург", "region": "Санкт-Петербург"},
    {"id": 6, "name": "Екатеринбург", "region": "Свердловская область"},
    {"id": 7, "name": "Воронеж", "region": "Воронежская область"},
    {"id": 8, "name": "Хабаровск", "region": "Хабаровский край"},
    {"id": 10, "name": "Челябинск", "region": "Челябинская область"},
    {"id": 11, "name": "Пермь", "region": "Пермский край"},
    {"id": 12, "name": "Новосибирск", "region": "Новосибирская область"},
    {"id": 13, "name": "Казань", "region": "Республика Татарстан"},
    {"id": 14, "name": "Нижний Новгород", "region": "Нижегородская область"},
    {"id": 15, "name": "Краснодар", "region": "Краснодарский край"},
    {"id": 16, "name": "Самара", "region": "Самарская область"},
    {"id": 17, "name": "Уфа", "region": "Республика Башкортостан"},
    {"id": 19, "name": "Ростов-на-Дону", "region": "Ростовская область"},
    {"id": 20, "name": "Волгоград", "region": "Волгоградская область"},
    {"id": 21, "name": "Красноярск", "region": "Красноярский край"},
    {"id": 22, "name": "Саратов", "region": "Саратовская область"},
    {"id": 23, "name": "Тюмень", "region": "Тюменская область"},
    {"id": 24, "name": "Тольятти", "region": "Самарская область"},
    {"id": 25, "name": "Ижевск", "region": "Удмуртская Республика"},
    {"id": 26, "name": "Барнаул", "region": "Алтайский край"},
    {"id": 27, "name": "Иркутск", "region": "Иркутская область"},
    {"id": 29, "name": "Ярославль", "region": "Ярославская область"},
    {"id": 30, "name": "Владивосток", "region": "Приморский край"},
    {"id": 32, "name": "Томск", "region": "Томская область"},
    {"id": 33, "name": "Оренбург", "region": "Оренбургская область"},
    {"id": 34, "name": "Кемерово", "region": "Кемеровская область"},
    {"id": 36, "name": "Рязань", "region": "Рязанская область"},
    {"id": 38, "name": "Астрахань", "region": "Астраханская область"},
    {"id": 39, "name": "Пенза", "region": "Пензенская область"},
    {"id": 40, "name": "Киров", "region": "Кировская область"},
    {"id": 41, "name": "Липецк", "region": "Липецкая область"},
    {"id": 43, "name": "Калининград", "region": "Калининградская область"},
    {"id": 44, "name": "Тула", "region": "Тульская область"},
    {"id": 45, "name": "Сочи", "region": "Краснодарский край"},
    {"id": 46, "name": "Курск", "region": "Курская область"},
    {"id": 47, "name": "Ставрополь", "region": "Ставропольский край"},
    {"id": 48, "name": "Ульяновск", "region": "Ульяновская область"},
    {"id": 50, "name": "Владимир", "region": "Владимирская область"},
    {"id": 51, "name": "Сургут", "region": "Ханты-Мансийский АО"},
    {"id": 52, "name": "Таганрог", "region": "Ростовская область"},
    {"id": 53, "name": "Нижневартовск", "region": "Ханты-Мансийский АО"},
    {"id": 54, "name": "Братск", "region": "Иркутская область"},
    {"id": 55, "name": "Иваново", "region": "Ивановская область"},
    {"id": 56, "name": "Магнитогорск", "region": "Челябинская область"},
    {"id": 57, "name": "Тверь", "region": "Тверская область"},
    {"id": 58, "name": "Бийск", "region": "Алтайский край"},
    {"id": 59, "name": "Нижний Тагил", "region": "Свердловская область"},
    {"id": 60, "name": "Кострома", "region": "Костромская область"},
    {"id": 61, "name": "Ноябрьск", "region": "Ямало-Ненецкий АО"},
    {"id": 62, "name": "Комсомольск-на-Амуре", "region": "Хабаровский край"},
    {"id": 63, "name": "Мурманск", "region": "Мурманская область"},
    {"id": 64, "name": "Петрозаводск", "region": "Республика Карелия"},
    {"id": 65, "name": "Грозный", "region": "Чеченская Республика"},
    {"id": 66, "name": "Смоленск", "region": "Смоленская область"},
    {"id": 67, "name": "Стерлитамак", "region": "Республика Башкортостан"},
    {"id": 68, "name": "Альметьевск", "region": "Республика Татарстан"},
    {"id": 69, "name": "Королёв", "region": "Московская область"},
    {"id": 70, "name": "Владикавказ", "region": "Республика Северная Осетия — Алания"},
    {"id": 71, "name": "Мичуринск", "region": "Тамбовская область"},
    {"id": 72, "name": "Великий Новгород", "region": "Новгородская область"},
    {"id": 73, "name": "Курган", "region": "Курганская область"},
    {"id": 74, "name": "Чита", "region": "Забайкальский край"},
    {"id": 75, "name": "Санкт-Петербург"},
]

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
}

def fetch_page(url, retries=3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=15) as resp:
                return resp.read().decode('utf-8', errors='replace')
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2)
            else:
                print(f"  Ошибка: {e}")
                return None

def parse_companies_from_html(html, city_name, region):
    companies = []
    
    name_pattern = re.compile(r'<h3[^>]*>\s*<a[^>]*>([^<]+)</a>\s*</h3>', re.DOTALL)
    desc_pattern = re.compile(r'<p[^>]*class="[^"]*description[^"]*"[^>]*>([^<]+)</p>', re.DOTALL)
    
    h3_links = re.findall(r'<h3[^>]*>\s*<a[^>]*href="(/companies/[^"]+)"[^>]*>([^<]+)</a>', html)
    
    if not h3_links:
        h3_links = re.findall(r'<a[^>]*href="(/companies/[^"]+)"[^>]*>\s*<h3[^>]*>([^<]+)</h3>', html)
    
    if not h3_links:
        h3_links = re.findall(r'href="(/companies/[^"]+)"[^>]*>([^<]{3,80})</a>', html)
    
    seen = set()
    for slug, name in h3_links:
        name = name.strip()
        if not name or len(name) < 2 or name in seen:
            continue
        if slug in seen:
            continue
        seen.add(slug)
        seen.add(name)
        
        desc_match = re.search(re.escape(name) + r'.*?<p[^>]*>([^<]{10,200})</p>', html, re.DOTALL)
        description = desc_match.group(1).strip() if desc_match else ""
        
        address_match = re.search(r'(?:г\.?\s*' + re.escape(city_name) + r'[^<]{5,100})', html)
        address = address_match.group(0).strip() if address_match else ""
        
        companies.append({
            "name": name,
            "slug": slug,
            "description": description,
            "city": city_name,
            "region": region,
            "address": address,
        })
    
    return companies

def get_max_page(html):
    pages = re.findall(r'[?&]page=(\d+)', html)
    if pages:
        return max(int(p) for p in pages)
    return 1

def main():
    all_companies = []
    total_pages_fetched = 0
    
    print(f"Начинаю загрузку компаний с {len(CITIES)} городов...")
    print("=" * 60)
    
    for i, city in enumerate(CITIES):
        print(f"\n[{i+1}/{len(CITIES)}] {city['name']} ({city.get('region', '')})...")
        
        url = f"{BASE_URL}?city_ids={city['id']}&page=1"
        html = fetch_page(url)
        
        if not html:
            print(f"  Не удалось загрузить первую страницу")
            continue
        
        max_page = get_max_page(html)
        pages_to_fetch = min(max_page, 30)
        
        print(f"  Страниц: {max_page}, загружаю: {pages_to_fetch}")
        
        companies_page1 = parse_companies_from_html(html, city['name'], city.get('region', ''))
        all_companies.extend(companies_page1)
        total_pages_fetched += 1
        
        for page in range(2, pages_to_fetch + 1):
            time.sleep(0.8)
            page_url = f"{BASE_URL}?city_ids={city['id']}&page={page}"
            page_html = fetch_page(page_url)
            
            if page_html:
                page_companies = parse_companies_from_html(page_html, city['name'], city.get('region', ''))
                all_companies.extend(page_companies)
                total_pages_fetched += 1
                
                if page % 10 == 0:
                    print(f"  Страница {page}/{pages_to_fetch}, всего: {len(all_companies)}")
            
            time.sleep(0.5)
        
        print(f"  Итого из {city['name']}: {sum(1 for c in all_companies if c['city'] == city['name'])}")
    
    print("\n" + "=" * 60)
    print(f"Загружено страниц: {total_pages_fetched}")
    print(f"Всего компаний: {len(all_companies)}")
    
    unique_companies = {}
    for c in all_companies:
        key = c['name'] + '|' + c['city']
        if key not in unique_companies:
            unique_companies[key] = c
    
    companies_list = list(unique_companies.values())
    print(f"Уникальных компаний: {len(companies_list)}")
    
    industries_map = {}
    for c in companies_list:
        desc = c.get('description', '').lower()
        if any(w in desc for w in ['производств', 'завод', 'фабрик', 'изготовлен']):
            industry = 'Промышленность и производство'
        elif any(w in desc for w in ['строитель', 'ремонт', 'монтаж', 'отделк']):
            industry = 'Строительство'
        elif any(w in desc for w in ['торговл', 'магазин', 'продаж', 'поставщик', 'интернет-магазин']):
            industry = 'Торговля'
        elif any(w in desc for w in ['услуг', 'сервис', 'обслужив']):
            industry = 'Услуги'
        elif any(w in desc for w in ['логистик', 'доставк', 'перевозк', 'транспорт']):
            industry = 'Логистика'
        elif any(w in desc for w in ['медицин', 'клиник', 'больниц', 'врач', 'здоровь']):
            industry = 'Здоровье и медицина'
        elif any(w in desc for w in ['обучен', 'школ', 'образован', 'курс', 'тренер']):
            industry = 'Образование'
        elif any(w in desc for w in ['реклам', 'маркетинг', 'продвижен', 'рекламн']):
            industry = 'Реклама'
        elif any(w in desc for w in ['финанс', 'бухгалтер', 'налог', 'банков', 'страхов']):
            industry = 'Бизнес, финансы и страхование'
        elif any(w in desc for w in ['IT', 'программ', 'разработк', 'сайт', 'цифров']):
            industry = 'IT и разработка'
        elif any(w in desc for w in ['авто', 'машин', 'транспорт']):
            industry = 'Авто-мото'
        elif any(w in desc for w in ['еда', 'продукт', 'питан', 'ресторан', 'кафе']):
            industry = 'Продукты питания'
        elif any(w in desc for w in ['недвижим', 'квартир', 'дом', 'офис']):
            industry = 'Недвижимость'
        elif any(w in desc for w in ['оборудован', 'техник', 'инструмент']):
            industry = 'Оборудование'
        else:
            industry = 'Другое'
        industries_map[c['name'] + '|' + c['city']] = industry
    
    output = {
        "companies": [],
        "metadata": {
            "source": "списокфирм.рф",
            "total_companies": len(companies_list),
            "total_regions": len(set(c['region'] for c in companies_list if c.get('region'))),
            "total_cities": len(set(c['city'] for c in companies_list)),
            "pages_fetched": total_pages_fetched,
            "scraped_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "note": "Автоматически собранная база компаний для холодных рассылок"
        }
    }
    
    for idx, c in enumerate(companies_list, 1):
        key = c['name'] + '|' + c['city']
        output["companies"].append({
            "id": f"comp-{idx:05d}",
            "name": c['name'],
            "legal_name": "",
            "region": c.get('region', ''),
            "city": c['city'],
            "industry": industries_map.get(key, 'Другое'),
            "description": c.get('description', ''),
            "address": c.get('address', ''),
            "phone": "",
            "email": "",
            "website": "",
            "inn": "",
            "status": "Действующая",
            "source_url": f"https://списокфирм.рф{c.get('slug', '')}",
            "coverage": c['city']
        })
    
    regions_count = {}
    for c in companies_list:
        r = c.get('region', 'Неизвестно')
        regions_count[r] = regions_count.get(r, 0) + 1
    
    cities_count = {}
    for c in companies_list:
        ci = c['city']
        cities_count[ci] = cities_count.get(ci, 0) + 1
    
    industries_count = {}
    for key, ind in industries_map.items():
        industries_count[ind] = industries_count.get(ind, 0) + 1
    
    output["metadata"]["regions_breakdown"] = dict(sorted(regions_count.items(), key=lambda x: -x[1]))
    output["metadata"]["cities_breakdown"] = dict(sorted(cities_count.items(), key=lambda x: -x[1]))
    output["metadata"]["industries_breakdown"] = dict(sorted(industries_count.items(), key=lambda x: -x[1]))
    
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_path = os.path.join(script_dir, '..', 'database', 'companies.json')
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    
    print(f"\nСохранено в: {output_path}")
    print(f"\nСтатистика по регионам:")
    for region, count in sorted(regions_count.items(), key=lambda x: -x[1])[:15]:
        print(f"  {region}: {count}")
    
    print(f"\nСтатистика по городам:")
    for city, count in sorted(cities_count.items(), key=lambda x: -x[1])[:15]:
        print(f"  {city}: {count}")
    
    print(f"\nСтатистика по отраслям:")
    for ind, count in sorted(industries_count.items(), key=lambda x: -x[1]):
        print(f"  {ind}: {count}")

if __name__ == '__main__':
    main()
