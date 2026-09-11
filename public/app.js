'use strict';
const $ = selector => document.querySelector(selector);
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let user = null, authMode = 'login';
const main = $('#main');
const PHOTO_BY_SLUG={
  'first-campaign':['campaign-editorial.png','Одно письмо направлено к точно выбранному получателю'],
  'personal-message':['personalization-editorial-v2.png','Исследователь связывает проверенный сигнал компании с персональным письмом'],
  'follow-up':['follow-up-editorial-v2.png','Три карточки пользы выстраиваются в спокойную последовательность'],
  quality:['database-editorial.png','Руки сортируют карточки компаний на светлом рабочем столе'],
  segmentation:['segmentation-editorial.png','Карточки контактов распределены по трём понятным сегментам'],
  enrichment:['enrichment-editorial-v2.png','Карточки компаний разделены на подтверждённые факты и гипотезы'],
  dns:['deliverability-editorial.png','Конверт проходит через три прозрачных шлюза проверки'],
  reputation:['reputation-editorial-v2.png','Сигнальный маяк показывает состояние почтового потока'],
  delivery:['delivery-routing-editorial-v2.png','Капсула письма проходит через развилку к разным зонам доставки'],
  errors:['errors-recovery-editorial-v2.png','Повреждённая керамическая схема подготовлена к аккуратному восстановлению'],
  'reply-rate':['analytics-editorial.png','Стеклянные столбцы и маркеры как образ аналитики'],
  'ab-test':['ab-test-editorial-v2.png','Два разных моста проходят одинаковое испытание'],
  'session-api':['email-accounts-editorial.png','Связанные конверты вокруг зелёной арки'],
  'crm-design':['crm-integration-editorial.png','Карточка контакта проходит через связанные модули интеграции'],
  'launch-checklist':['launch-checklist-editorial-v2.png','Набор контрольных точек собран вокруг рычага запуска'],
  writing:['writing-editorial.png','Четыре смысловых слоя складываются в одно письмо'],
  'agency-model':['agency-model-editorial-v2.png','Исследование, письмо и встреча связаны в измеримый рабочий процесс'],
  'supplier-model':['supplier-model-editorial-v2.png','Один продукт рассматривается с позиции закупки и продажи'],
  'roi-model':['roi-model-editorial-v2.png','Три сценария превращают ресурсы в измеримый результат'],
  'new-brand':['new-brand-editorial-v2.png','Материалы постепенно складываются в цельный визуальный характер'],
  'server-accounts':['server-accounts-editorial-v2.png','Профиль безопасно переходит из локального хранилища на сервер'],
  'honest-content':['honest-content-editorial-v2.png','Письмо и ценность взвешены на прозрачных весах'],
  relevance:['relevance-editorial-v2.png','Один релевантный сигнал выделен среди множества вариантов'],
  'account-help':['account-help-editorial-v2.png','Карточка профиля соединена с ключевыми данными аккаунта'],
  'data-help':['data-help-editorial-v2.png','Почтовые данные проходят по прозрачному пути к сохранённой копии'],
  'support-request':['support-request-editorial-v2.png','Три последовательных обращения движутся по единому маршруту'],
  feedback:['feedback-editorial.png','Несколько ответов сходятся в новое направление']
};
function graphic(kind = 0) {
  const art = [
    '<path d="M60 36h160v100H60z" fill="#fffdf5"/><path d="m60 36 80 57 80-57M60 136l59-61m101 61-59-61" fill="none" stroke="#477957" stroke-width="2"/><circle cx="220" cy="41" r="28" fill="#d6f477"/><path d="m209 49 20-20m-19 0h19v19" fill="none" stroke="#173f35" stroke-width="3"/>',
    '<rect x="35" y="25" width="205" height="125" rx="12" fill="#fffdf5"/><path d="M53 60h168M53 90h168M53 120h168" stroke="#dce1d8"/><circle cx="64" cy="45" r="5" fill="#729b52"/><path d="M80 45h65M80 76h100M80 106h80M80 136h115" stroke="#6c8571" stroke-width="5"/><circle cx="237" cy="121" r="27" fill="#d6f477"/><path d="m225 121 9 9 17-19" fill="none" stroke="#173f35" stroke-width="3"/>',
    '<rect x="50" y="102" width="36" height="43" rx="6" fill="#c2d6a7"/><rect x="102" y="76" width="36" height="69" rx="6" fill="#92b56c"/><rect x="154" y="50" width="36" height="95" rx="6" fill="#5b8757"/><rect x="206" y="22" width="36" height="123" rx="6" fill="#173f35"/><path d="m52 74 61-24 52-13 48-25" fill="none" stroke="#173f35" stroke-width="2"/><circle cx="53" cy="74" r="6" fill="#d6f477"/>',
    '<path d="M66 87h142" stroke="#78976b" stroke-width="2" stroke-dasharray="5 5"/><circle cx="60" cy="87" r="38" fill="#fffdf5"/><circle cx="222" cy="87" r="38" fill="#173f35"/><path d="m46 87 14-13 14 13-14 13z" fill="#8daf67"/><path d="m209 87 10 10 19-22" fill="none" stroke="#d6f477" stroke-width="4"/><rect x="112" y="65" width="60" height="44" rx="12" fill="#d6f477"/><path d="m135 79 9 8-9 8" fill="none" stroke="#173f35" stroke-width="3"/>'
  ];
  return `<svg viewBox="0 0 280 170" role="img" aria-label="Иллюстрация: ${['письмо и ответ','структура базы','аналитика','связь процессов'][kind % 4]}">${art[kind % 4]}</svg>`;
}
function cover(a, hero = false) { const photo=PHOTO_BY_SLUG[a.slug];return photo?`<div class="cover editorial-photo"><img src="/assets/${photo[0]}" alt="${photo[1]}" loading="lazy"></div>`:hero?'<div class="cover"><img src="/assets/hero.png" alt="Бумажный конверт, зелёная стеклянная арка и лаймовый шар" loading="lazy"></div>':`<div class="cover graphic" style="background:${['#e8eddf','#f0eadd','#e4e9e2','#e8edcf'][a.visual]}">${graphic(a.visual)}</div>`; }
function card(a) { return `<a class="card" href="#${a.section}/${a.slug}">${cover(a, a.slug === 'launch-checklist' || a.slug === 'new-brand')}<div class="card-body"><div class="card-meta"><span>${esc(SECTIONS[a.section][0])}</span><span>${a.time} мин ↗</span></div><h3>${esc(a.title)}</h3><p>${esc(a.lead)}</p></div></a>`; }
function sidebar(section) { return `<aside class="sidebar" aria-label="Разделы библиотеки"><span class="eyebrow">Библиотека</span>${Object.entries(SECTIONS).map(([id, data]) => `<a href="#${id}" class="${id === section ? 'active' : ''}" ${id === section ? 'aria-current="page"' : ''}>${data[0]}<small>${ARTICLES.filter(a => a.section === id).length}</small></a>`).join('')}</aside>`; }
function home() {
  main.innerHTML = `<section class="hero"><div><span class="eyebrow">B2B-КОММУНИКАЦИИ С ЧЕЛОВЕЧЕСКИМ ЛИЦОМ</span><h1>С письма<br>начинается<br><em>большее.</em></h1><p>Находите своих клиентов. Говорите по делу.<br>Превращайте первое касание в начало<br>хороших деловых отношений.</p><div class="hero-actions">${user?(user.tariff&&user.tariff!=='none'?'<a class="button" href="#sequences">Открыть цепочки ↗</a>':'<a class="button" href="#companies">Открыть компании ↗</a>'):'<button class="button" data-register>Начать знакомство ↗</button>'}<a class="button outline" href="#guides">Посмотреть гайды</a></div><p class="hero-note">Для команд, которые ценят качество каждого контакта.</p></div><div class="hero-art"><img src="/assets/hero.png" alt="Скульптурный конверт: визуальный образ нового разговора" fetchpriority="high"><div class="seal">МЕНЬШЕ ШУМА<b>↗</b>БОЛЬШЕ СМЫСЛА</div><div class="floating-note"><strong>↗ Есть о чём поговорить</strong>Сначала польза. Затем — диалог.</div></div></section><section class="quick-start" aria-label="Быстрый старт"><div><span class="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</span><h2>От компании к первому письму</h2></div><a href="#companies"><span class="step-number">01</span><span><strong>Выбрать компании</strong><small>Поиск и список получателей</small></span><span aria-hidden="true">↗</span></a><a data-paid-workspace href="#email-accounts"><span class="step-number">02</span><span><strong>Подключить почту</strong><small>Адреса и лимиты отправки</small></span><span aria-hidden="true">↗</span></a><a data-paid-workspace href="#sequences"><span class="step-number">03</span><span><strong>Собрать шаблоны</strong><small>Тексты, интервалы и статусы</small></span><span aria-hidden="true">↗</span></a></section>>
  <div class="strip"><div><strong>47 958</strong><span>записей в основном наборе¹</span></div><div><strong>9 разделов</strong><span>от первого письма до аналитики</span></div><div><strong>${ARTICLES.length} материалов</strong><span>примеры, схемы и расчёты</span></div><div><strong>Один подход</strong><span>внимание к человеку на той стороне</span></div></div>
  <section class="section"><div class="section-top"><div><span class="eyebrow">ОТ КОНТАКТА К ДИАЛОГУ</span><h2>Всё начинается<br>с правильного подхода.</h2></div><p>Разберите каждый этап коммуникации —<br>и соберите свой рабочий процесс.</p></div><div class="grid feature-grid">${[['cold','↗','Письмо по делу','Контекст, предложение и понятный следующий шаг.'],['base','▦','Своя аудитория','Структура базы, проверка и точная сегментация.'],['warm','◎','Доверие к отправителю','Настройка почты и разбор сигналов доставки.'],['api','⌘','Связанные процессы','Работающий API аккаунтов и схемы интеграций.']].map(([id,icon,title,desc])=>`<div class="feature-card"><div class="feature-icon">${icon}</div><h3>${title}</h3><p>${desc}</p><a href="#${id}">Разобраться ↗</a></div>`).join('')}</div><p class="small-text muted">¹ Срез локального набора компаний от 07.09.2026. Это записи компаний, а не число проверенных email.</p></section>
  <section class="section"><div class="section-top"><div><span class="eyebrow">ЖУРНАЛ ОТКЛИКА</span><h2>Идеи, которые<br>можно проверить.</h2></div><p>Новые подробные разборы: от выбора аудитории до работы с ответами.</p></div><div class="editorial-grid">${[ARTICLES.find(a=>a.slug==='first-campaign'),ARTICLES.find(a=>a.slug==='writing'),ARTICLES.find(a=>a.slug==='feedback')].map(card).join('')}</div><div class="journal-action"><a class="button outline" href="#guides">Все материалы ↗</a></div></section>
  <section class="cta"><div><span class="eyebrow">ВАШ СЛЕДУЮЩИЙ ШАГ</span><h2>Хороший диалог<br>начинается с вас.</h2><p>Сформулируйте задачу. Найдите аудиторию. Сделайте первый шаг.</p></div><a class="button lime" href="#guides/launch-checklist">Собрать первый пилот ↗</a></section>`;
}
function library(section) {
  const data = SECTIONS[section], items = ARTICLES.filter(a=>a.section===section);
  main.innerHTML = `<section class="library-head"><span class="eyebrow">БИБЛИОТЕКА ОТКЛИКА / ${data[2]}</span><h1>${data[0]}<span class="brand-dot">.</span></h1><p>${data[1]}</p></section><div class="library">${sidebar(section)}<div><label for="search" class="small-text muted">Найти материал в разделе</label><input class="search" id="search" type="search" placeholder="Название, тема или ключевое слово…"><div class="library-grid" id="results">${items.map(card).join('')}</div><p id="result-count" role="status" class="small-text muted">${items.length} материалов</p>${section==='support' ? contactForm() : ''}</div></div>`;
  $('#search').addEventListener('input', e => { const q=e.target.value.trim().toLocaleLowerCase('ru'); const filtered=items.filter(a=>(a.title+' '+a.lead+' '+a.paragraphs.join(' ')+' '+(a.scene||'')+' '+(a.takeaway||'')).toLocaleLowerCase('ru').includes(q)); $('#results').innerHTML=filtered.length ? filtered.map(card).join('') : '<p class="empty">Ничего не найдено. Попробуйте другое слово.</p>'; $('#result-count').textContent=q?`Найдено: ${filtered.length}`:`${items.length} материалов`; });
}
function chart(a) {
  if (!a.chart) return '';
  const max = Math.max(...a.chart.map(row=>row[1]));
  return `<figure class="chart"><figcaption><strong>${a.slug==='quality' ? 'Объём исходных наборов' : 'Разбираем на цифрах'}</strong></figcaption>${a.chart.map(([label,value])=>`<div class="chart-row"><span>${label}</span><div class="bar"><i style="width:${value/max*100}%"></i></div><b>${value.toLocaleString('ru')}</b></div>`).join('')}<small>${a.slug==='quality' ? 'Локальные файлы проекта, 07.09.2026. Записи могут пересекаться.' : 'Учебные, условные данные. Это иллюстрация расчёта, а не статистика клиентов или отрасли.'}</small></figure>`;
}
function showArticle(a) {
  const items=ARTICLES.filter(x=>x.section===a.section), index=items.indexOf(a), next=items[index+1];
  main.innerHTML=`<div class="library-head"><div class="breadcrumbs"><a href="#home">Главная</a> / <a href="#${a.section}">${SECTIONS[a.section][0]}</a> / Статья</div></div><div class="library">${sidebar(a.section)}<div><article class="article"><span class="eyebrow">${SECTIONS[a.section][0]} · ${a.time} МИН ЧТЕНИЯ</span><h1>${esc(a.title)}</h1><p class="lead">${esc(a.lead)}</p>${cover(a)}${a.scene?`<div class="article-scene"><span>Ситуация</span><p>${esc(a.scene)}</p></div>`:''}${a.headings.map((h,i)=>`<h2>${i+1}. ${esc(h)}</h2><p>${esc(a.paragraphs[i])}</p>`).join('')}${a.takeaway?`<h2>Что меняется в работе</h2><p>${esc(a.takeaway)}</p>`:''}<h2>На практике</h2><div class="example">${esc(a.example)}</div>${chart(a)}<div class="callout"><strong>Заберите в работу</strong><ol>${a.checklist.map(t=>`<li>${esc(t)}</li>`).join('')}</ol></div>${a.source ? `<div class="sources">Источник: ${a.source[1] ? `<a href="${a.source[1]}" target="_blank" rel="noopener noreferrer">${esc(a.source[0])} ↗</a>` : esc(a.source[0])}. Проверено 09.09.2026.</div>` : '<div class="sources">Редакционный практикум Отклика · обновлено 09.09.2026. Примеры не являются обещанием результата.</div>'}</article><div class="article-nav"><a href="#${a.section}">← Все материалы раздела</a>${next?`<a href="#${next.section}/${next.slug}">Далее: ${esc(next.title)} →</a>`:''}</div>${a.slug==='support-request'?contactForm():''}</div></div>`;
}
function contactForm() { return `<section class="contact-form"><h2>Расскажите о задаче</h2><p class="small-text muted">Заявка сохранится на локальном сервере. Внешние уведомления пока не подключены.</p><form id="request-form"><label>Ваш email<input type="email" name="email" required maxlength="254" autocomplete="email"></label><label>Что хотите обсудить?<textarea name="message" required minlength="10" maxlength="3000" placeholder="Опишите задачу или вопрос…"></textarea></label><p class="form-status" role="status"></p><button class="button">Сохранить заявку ↗</button></form></section>`; }
function pricing() { main.innerHTML=`<section class="library-head"><span class="eyebrow">ФОРМАТ СОТРУДНИЧЕСТВА</span><h1>Начните с задачи.</h1><p>Аккаунт и библиотека доступны бесплатно. Коммерческие условия сопровождения обсуждаются отдельно; покупка и автоматическая отправка рассылок пока не подключены.</p><figure class="workspace-art"><img src="/assets/collaboration-plans-v1.png" alt="Три разных модуля соединяются в общий павильон" width="1536" height="1024" decoding="async"></figure></section><section class="section"><div class="grid">${[['Самостоятельно','Бесплатно','Аккаунт, библиотека статей, примеры и чек-листы.','Создать аккаунт','register'],['Вместе с командой','По запросу','Обсуждение сегмента, предложения и плана пилота.','Описать задачу','support'],['Под ваш процесс','По запросу','Обсуждение требований к данным и будущим интеграциям.','Обсудить проект','support']].map(([t,p,d,b,action])=>`<div class="card"><div class="card-body"><span class="eyebrow">${t}</span><h2 class="price">${p}</h2><p>${d}</p>${action==='register'?`<button class="button" data-register>${b} ↗</button>`:`<a class="button outline" href="#support">${b} ↗</a>`}</div></div>`).join('')}</div></section>`; }
function profile() { main.innerHTML=user?`<section class="section profile"><figure class="workspace-art"><img src="/assets/profile-workspace-v1.png" alt="Личный кабинет: символ профиля, стеклянный ключ и карточки" width="1536" height="1024" decoding="async"></figure><span class="eyebrow">ВАШ АККАУНТ</span><h2>Здравствуйте, ${esc(user.name)}.</h2><dl><dt>Email</dt><dd>${esc(user.email)}</dd><dt>Компания</dt><dd>${esc(user.company || 'Не указана')}</dd></dl><p>Аккаунт готов. Начните с материалов для первого пилота.</p><a class="button" href="#guides">Открыть гайды ↗</a> <button class="button outline" id="logout">Выйти</button></section>`:'<section class="section"><h2>Войдите в аккаунт</h2><button class="button" data-login>Войти</button></section>'; }
function emailAccountsShell() {
  if (!user) { main.innerHTML='<section class="gate"><div class="gate-icon">@</div><span class="eyebrow">EMAIL ACCOUNTS</span><h1>Сначала войдите</h1><p>Подключение почтовых ящиков доступно пользователям с аккаунтом и активной подпиской.</p><button class="button" data-login>Войти в аккаунт ↗</button></section>'; return; }
  if (!user.tariff || user.tariff==='none') { main.innerHTML='<section class="gate"><div class="gate-icon locked">◇</div><span class="eyebrow">ФУНКЦИЯ ПО ПОДПИСКЕ</span><h1>Email Accounts</h1><p>Управление отправителями входит в платные тарифы. После активации здесь появятся подключение почты, дневные лимиты и счётчики отправки.</p><a class="button" href="#pricing">Посмотреть тарифы ↗</a></section>'; return; }
  main.innerHTML='<section class="accounts-head"><div><span class="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</span><h1>Почтовые ящики<span class="brand-dot">.</span></h1><p>Подключайте адреса отправителей, управляйте их активностью и дневной нагрузкой.</p></div><button class="button" id="add-email-btn">+ Добавить почту</button></section><div class="accounts-visual"><img src="/assets/email-accounts-editorial.png" alt="Три связанных конверта как образ системы почтовых аккаунтов"></div><section class="account-summary" id="account-summary"><div><b>0</b><span>подключено</span></div><div><b>0</b><span>активно</span></div><div><b>0</b><span>отправлено сегодня</span></div><div><b>0</b><span>запланировано</span></div></section><section class="email-workspace"><div id="email-list" class="email-list"><div class="loading-state">Загружаем почтовые ящики…</div></div></section>';
  $('#add-email-btn').addEventListener('click',()=>{$('#email-form').reset();$('#email-form .form-status').textContent='';$('#add-email').showModal();}); loadEmailAccounts();
}
function providerName(provider){return {gmail:'Gmail',outlook:'Outlook',other:'Другая почта'}[provider]||provider;}
function renderEmailAccounts(accounts) {
  const connected=accounts.filter(a=>a.status==='connected').length, active=accounts.filter(a=>a.enabled).length, sent=accounts.reduce((n,a)=>n+a.sent_today,0), queued=accounts.reduce((n,a)=>n+a.queued_today,0);
  $('#account-summary').innerHTML=`<div><b>${connected}</b><span>подключено</span></div><div><b>${active}</b><span>активно</span></div><div><b>${sent}</b><span>отправлено сегодня</span></div><div><b>${queued}</b><span>запланировано</span></div>`;
  $('#email-list').innerHTML=accounts.length?accounts.map(a=>`<article class="email-account" data-id="${a.id}"><div class="mail-identity"><span class="provider-icon ${a.provider}">${a.provider==='gmail'?'G':a.provider==='outlook'?'O':'@'}</span><div><h3>${esc(a.email)}</h3><p>${providerName(a.provider)} · <span class="status ${a.status}">${a.status==='connected'?'Подключена':'Нужна авторизация'}</span></p></div></div><div class="mail-counters"><div><b>${a.sent_today}</b><span>отправлено</span></div><div><b>${a.queued_today}</b><span>в очереди</span></div><div><b>${a.daily_limit}</b><span>лимит / день</span></div></div><div class="mail-controls">${a.status!=='connected'?`<button class="button outline authorize-mail">Войти в ${providerName(a.provider)}</button>`:''}<label class="limit-label">Лимит в день<input class="limit-input" type="number" min="1" max="500" value="${a.daily_limit}" aria-label="Дневной лимит для ${esc(a.email)}"></label><button class="plain save-limit">Сохранить</button><label class="toggle"><input type="checkbox" class="enable-mail" ${a.enabled?'checked':''} ${a.status!=='connected'?'disabled':''}><span></span><b>${a.enabled?'Используется':'Выключена'}</b></label></div><p class="row-status" role="status"></p></article>`).join(''):'<div class="empty-accounts"><div class="gate-icon">@</div><h2>Добавьте первую почту</h2><p>Она появится здесь вместе с дневным лимитом и счётчиками. Для доступа к письмам потребуется авторизация у провайдера.</p><button class="button" id="first-email">+ Добавить почту</button></div>';
  gmailControls(accounts);
  $('#first-email')?.addEventListener('click',()=>$('#add-email-btn').click());
  document.querySelectorAll('.email-account').forEach(row=>{const id=row.dataset.id,status=row.querySelector('.row-status'),input=row.querySelector('.limit-input');row.querySelector('.save-limit').addEventListener('click',async e=>{e.target.disabled=true;try{await patchEmail(id,{daily_limit:Number(input.value)});await loadEmailAccounts();const fresh=document.querySelector(`.email-account[data-id="${id}"] .row-status`);if(fresh)fresh.textContent='Лимит сохранён.';}catch(err){status.textContent=err.message;}finally{e.target.disabled=false;}});row.querySelector('.enable-mail').addEventListener('change',async e=>{try{await patchEmail(id,{enabled:e.target.checked});}catch(err){status.textContent=err.message;}finally{loadEmailAccounts();}});row.querySelector('.authorize-mail')?.addEventListener('click',async e=>{e.target.disabled=true;status.textContent='Открываем авторизацию…';try{const data=await api(`/api/email-accounts/${id}/authorize`,{});status.textContent=data.demo?'Демо-подключение завершено.':'Почта подключена.';loadEmailAccounts();}catch(err){status.textContent=err.message;}finally{e.target.disabled=false;}});});
}
async function loadEmailAccounts(){try{const data=await api('/api/email-accounts');if($('#email-list'))renderEmailAccounts(data.accounts);}catch(err){if($('#email-list'))$('#email-list').innerHTML=`<div class="empty-accounts"><h2>Не удалось загрузить почту</h2><p>${esc(err.message)}</p></div>`;}}
function gmailControls(accounts){
  for(const a of accounts.filter(a=>a.provider==='gmail')){
    const row=document.querySelector(`.email-account[data-id="${a.id}"]`);
    row.querySelector('.authorize-mail')?.remove();
    const box=document.createElement('div');box.style.gridColumn='1 / -1';
    box.innerHTML=`<button class="button outline google-connect">${a.status==='connected'?'Переподключить Google':'Подключить Google'}</button><p class="gmail-status" role="status"></p>`;
    row.append(box);const status=box.querySelector('.gmail-status');const tracking=document.createElement('p');tracking.className='small-text';tracking.textContent=a.inbox_tracking?'Перед повторной отправкой проверяются ответы и отчёты недоставки.':'Переподключите Google и разрешите чтение писем для проверки ответов и недоставки.';box.prepend(tracking);
    const composeLink=document.createElement('a');composeLink.href='#sequences';composeLink.className='workspace-compose-link';composeLink.textContent='Шаблоны писем →';box.querySelector('.google-connect').after(composeLink);
    box.querySelector('.google-connect').addEventListener('click',async e=>{e.target.disabled=true;try{const d=await api(`/api/gmail/${a.id}/connect`,{});location.assign(d.url);}catch(err){status.textContent=err.message;e.target.disabled=false;}});

  }
}
async function refreshMailCounters(){
  const {accounts}=await api('/api/email-accounts');
  const totals=[accounts.filter(a=>a.status==='connected').length,accounts.filter(a=>a.enabled).length,accounts.reduce((n,a)=>n+a.sent_today,0),accounts.reduce((n,a)=>n+a.queued_today,0)];
  document.querySelectorAll('#account-summary b').forEach((el,i)=>{el.textContent=totals[i];});
  for(const a of accounts){
    const values=[a.sent_today,a.queued_today,a.daily_limit];
    document.querySelectorAll(`.email-account[data-id="${a.id}"] .mail-counters b`).forEach((el,i)=>{el.textContent=values[i];});
  }
}
async function patchEmail(id,body){return api(`/api/email-accounts/${id}`,body,'PATCH');}
function route() {
  const [section,slug] = (location.hash.slice(1) || 'home').split('/');
  setWorkspaceLayout(section);
  if(section==='companies'){
    if(typeof companiesPage!=='function')return;
    document.querySelectorAll('header details').forEach(d=>d.open=false);$('header').classList.remove('menu-open');$('.mobile-toggle').setAttribute('aria-expanded','false');
    companiesPage();document.title='Компании России — Отклик';window.scrollTo(0,0);main.focus({preventScroll:true});return;
  }
  if(section==='sequences'){
    if(typeof sequencesPage!=='function')return;
    document.querySelectorAll('header details').forEach(d=>d.open=false);$('header').classList.remove('menu-open');$('.mobile-toggle').setAttribute('aria-expanded','false');
    sequencesPage();document.title='Шаблоны и цепочки — Отклик';window.scrollTo(0,0);main.focus({preventScroll:true});return;
  }
  if(section==='mail-health'){
    if(typeof mailHealthPage!=='function')return;
    document.querySelectorAll('header details').forEach(d=>d.open=false);$('header').classList.remove('menu-open');$('.mobile-toggle').setAttribute('aria-expanded','false');
    mailHealthPage();document.title='Здоровье почты — Отклик';window.scrollTo(0,0);main.focus({preventScroll:true});return;
  }
  document.querySelectorAll('header details').forEach(d=>d.open=false); $('header').classList.remove('menu-open'); $('.mobile-toggle').setAttribute('aria-expanded','false');
  if (!section || section==='home') home(); else if (section==='pricing') pricing(); else if (section==='profile') profile(); else if(section==='email-accounts') emailAccountsShell(); else if (SECTIONS[section]) { const a=slug&&ARTICLES.find(x=>x.section===section&&x.slug===slug); if(a) showArticle(a); else if(!slug) library(section); else main.innerHTML='<section class="section"><h2>Статья не найдена</h2><a href="#guides">Вернуться в библиотеку →</a></section>'; } else main.innerHTML='<section class="section"><h2>Страница не найдена</h2><a href="#home">На главную →</a></section>';
  document.title = `${slug ? (ARTICLES.find(a=>a.section===section&&a.slug===slug)?.title || 'Страница не найдена') : (SECTIONS[section]?.[0] || {home:'С письма начинается большее',pricing:'Тарифы',profile:'Ваш аккаунт','email-accounts':'Email Accounts'}[section] || 'Отклик')} — Отклик`;
  window.scrollTo(0,0); main.focus({preventScroll:true});
  const form=$('#request-form'); if(form) form.addEventListener('submit',saveRequest);
  const logout=$('#logout'); if(logout) logout.addEventListener('click',async()=>{try{await api('/api/logout',{});user=null;updateAccount();location.hash='home';}catch(e){logout.textContent='Не удалось выйти. Повторить';}});
}
function setWorkspaceLayout(section){
  const active=['email-accounts','sequences','companies','mail-health'].includes(section);
  document.body.classList.toggle('workspace-mode',active);
  let rail=document.querySelector('#workspace-nav');
  if(!rail){
    rail=document.createElement('nav');rail.id='workspace-nav';rail.setAttribute('aria-label','Рабочее пространство');
    rail.innerHTML='<a href="#companies" aria-label="Компании" title="Компании"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h2m2 0h2M9 11h2m2 0h2M10 21v-5h4v5"/></svg><span>Компании</span></a><a data-paid-workspace href="#email-accounts" aria-label="Почтовые ящики" title="Почтовые ящики"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg><span>Почтовые<br>ящики</span></a><a data-paid-workspace href="#mail-health" aria-label="Здоровье почты" title="Здоровье почты"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 21s-7-4.7-7-10.2A4.1 4.1 0 0 1 12 7.8a4.1 4.1 0 0 1 7 3c0 5.5-7 10.2-7 10.2Z"/><path d="M8.5 12h7M12 8.5v7"/></svg><span>Здоровье<br>почты</span></a><a data-paid-workspace href="#sequences" aria-label="Письма: шаблоны и отправка" title="Письма: шаблоны и отправка"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="m3 10 18-7-7 18-3-8-8-3Z"/><path d="m11 13 10-10"/></svg><span>Письма</span></a>';document.body.append(rail);
  }
  rail.hidden=!active;
  let shortcuts=document.querySelector('.workspace-shortcuts');if(!shortcuts){shortcuts=document.createElement('div');shortcuts.className='workspace-shortcuts';shortcuts.innerHTML='<a href="#guides">База знаний</a><a href="#profile">Мой профиль ↗</a>';document.querySelector('header').append(shortcuts);}shortcuts.hidden=!active;
  rail.querySelectorAll('a').forEach(a=>{if(a.hash==='#'+section)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
}
async function api(url, body, method) {
  let res; try { res=await fetch(url,{method:method||(body===undefined?'GET':'POST'),headers:body===undefined?{}:{'Content-Type':'application/json'},credentials:'same-origin',...(body===undefined?{}:{body:JSON.stringify(body)})}); } catch { throw new Error('Не удалось связаться с сервером. Проверьте, что он запущен.'); }
  const data=await res.json().catch(()=>({error:'Сервер вернул неожиданный ответ. Повторите позже.'}));
  if(res.status===401&&!['/api/login','/api/register'].includes(url)){
    const wasLoggedIn=Boolean(user);user=null;updateAccount();
    if(wasLoggedIn){
      $('#add-email')?.close();
      queueMicrotask(()=>{if(['#profile','#email-accounts','#mail-health','#sequences','#companies'].includes(location.hash))route();openAuth('login');$('#auth .form-status').textContent='Сессия завершилась. Войдите снова — подключённая почта сохранена.';});
    }
  }
  if(!res.ok)throw new Error(data.error||'Не удалось выполнить запрос.');return data;
}
function updateAccount() { const subscribed=Boolean(user?.tariff&&user.tariff!=='none');document.body.classList.toggle('authenticated',Boolean(user));document.body.classList.toggle('subscribed',subscribed);$('#login').textContent=user?'Мой профиль':'Войти';$('#start').textContent=user?'Материалы ↗':'Начать ↗'; }
function openAuth(mode) { if(user){location.hash='profile';return;} authMode=mode;const reg=mode==='register';$('#auth-title').textContent=reg?'Давайте знакомиться':'С возвращением';$('#name-field').hidden=!reg;$('#confirm-field').hidden=!reg;const f=$('#auth-form');f.elements.name.required=reg;f.elements.confirm.required=reg;f.elements.password.autocomplete=reg?'new-password':'current-password';f.elements.password.minLength=reg?8:6;f.querySelector('[type=submit]').textContent=reg?'Создать аккаунт':'Войти';$('.switch').textContent=reg?'Уже есть аккаунт? Войти':'Создать аккаунт';f.querySelector('.form-status').textContent='';if(!$('#auth').open)$('#auth').showModal(); }
$('#auth-form').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,status=f.querySelector('.form-status'),button=f.querySelector('[type=submit]');if(authMode==='register'&&f.elements.password.value!==f.elements.confirm.value){status.textContent='Пароли не совпадают.';return;}button.disabled=true;status.textContent='Проверяем данные…';try { const data=await api(`/api/${authMode}`,{name:f.elements.name.value,email:f.elements.email.value,password:f.elements.password.value});user=data.user;f.reset();$('#auth').close();updateAccount();location.hash='profile';if(location.hash==='#profile')route(); }catch(err){status.textContent=err.message;}finally{button.disabled=false;}});
$('#email-form').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,status=f.querySelector('.form-status'),button=f.querySelector('button[type=submit]');button.disabled=true;status.textContent='Добавляем ящик…';try{await api('/api/email-accounts',{provider:f.elements.provider.value,email:f.elements.email.value});$('#add-email').close();loadEmailAccounts();}catch(err){status.textContent=err.message;}finally{button.disabled=false;}});
async function saveRequest(e){e.preventDefault();const f=e.currentTarget,b=f.querySelector('button'),s=f.querySelector('.form-status');b.disabled=true;s.classList.remove('success');s.textContent='Сохраняем…';try{const data=await api('/api/requests',{email:f.elements.email.value,message:f.elements.message.value});s.textContent=`Заявка сохранена. Номер: ${data.id}.`;s.classList.add('success');f.reset();}catch(err){s.textContent=err.message;}finally{b.disabled=false;}}
$('#login').addEventListener('click',()=>user?location.hash='profile':openAuth('login'));$('#start').addEventListener('click',()=>user?location.hash='guides':openAuth('register'));
document.addEventListener('click',e=>{if(e.target.closest('[data-register]'))openAuth('register');if(e.target.closest('[data-login]'))openAuth('login');if(!e.target.closest('header details'))document.querySelectorAll('header details').forEach(d=>d.open=false);});
$('.switch').addEventListener('click',()=>openAuth(authMode==='login'?'register':'login'));$('#auth .close').addEventListener('click',()=>$('#auth').close());$('#auth').addEventListener('click',e=>{if(e.target===$('#auth')){const r=$('#auth').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('#auth').close();}});
$('#add-email .close').addEventListener('click',()=>$('#add-email').close());
$('.mobile-toggle').addEventListener('click',()=>{const open=$('header').classList.toggle('menu-open');$('.mobile-toggle').setAttribute('aria-expanded',String(open));});
$('.skip').addEventListener('click',e=>{e.preventDefault();main.focus();});
window.addEventListener('hashchange',route);window.addEventListener('DOMContentLoaded',route);api('/api/me').then(data=>{user=data.user;updateAccount();if(['','#home','#profile','#email-accounts','#mail-health','#sequences','#companies'].includes(location.hash))route();}).catch(()=>{}).finally(()=>{const mode=new URLSearchParams(location.search).get('auth');if(mode==='login'||mode==='register'){const clean=new URL(location.href);clean.searchParams.delete('auth');history.replaceState(null,'',clean.pathname+clean.search+clean.hash);openAuth(mode);}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&user)api('/api/me').catch(()=>{});});

// Close navigation with Escape and expose the current destination.
document.addEventListener('keydown',event=>{if(event.key==='Escape'){document.querySelector('header').classList.remove('menu-open');document.querySelector('.mobile-toggle').setAttribute('aria-expanded','false');document.querySelectorAll('header details').forEach(d=>d.open=false);}});
function markNavigation(){document.querySelectorAll('header nav a').forEach(a=>{if(a.hash===location.hash)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});}
window.addEventListener('hashchange',markNavigation);markNavigation();
