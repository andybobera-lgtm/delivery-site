// SEO: страницы категорий и блюд для поисковиков, карта сайта, мета-теги главной страницы.
// Все цены и названия берутся из того же каталога, что и на сайте (в том числе цены, изменённые в админке).
const fs = require('fs');
const path = require('path');

// Адреса категорий латиницей (так надёжнее для ссылок). Новые категории получат адрес автоматически.
const CAT_SLUGS = {
  'Акции и Наборы': 'akcii-i-nabory',
  'Шашлык': 'shashlyk',
  'Хинкал': 'hinkal',
  'Чуду': 'chudu',
  'Курзе': 'kurze',
  'Узбекские блюда': 'uzbekskie-blyuda',
  'Выпечка': 'vypechka',
  'Супы': 'supy',
  'Салаты': 'salaty',
  'Неаполитанская пицца': 'pizza',
  'Десерты': 'deserty',
  'Соусы': 'sousy',
  'Напитки': 'napitki',
};

// Заголовки и вводные тексты категорий — то, что люди вводят в поиск («заказать шашлык с доставкой»)
const CAT_SEO = {
  'Акции и Наборы': { h1: 'Акции и наборы с доставкой', title: 'Наборы и акции — еда с доставкой в Москве', lead: 'Готовые наборы и выгодные предложения: удобно заказать на компанию или на семью.' },
  'Шашлык': { h1: 'Шашлык с доставкой на дом', title: 'Заказать шашлык с доставкой на дом в Москве', lead: 'Шашлык и люля-кебаб, которые готовят после вашего заказа и привозят горячими.' },
  'Хинкал': { h1: 'Хинкал с доставкой', title: 'Хинкал — заказать с доставкой в Москве', lead: 'Аварский, даргинский, лакский и тонкий хинкал, хинкал с кукурузной мукой.' },
  'Чуду': { h1: 'Чуду с доставкой', title: 'Чуду (дагестанские лепёшки) — заказать с доставкой в Москве', lead: 'Тонкие лепёшки чуду с разными начинками: с мясом, сыром и зеленью, зеленью, тыквой.' },
  'Курзе': { h1: 'Курзе с доставкой', title: 'Курзе (дагестанские пельмени) — заказать с доставкой в Москве', lead: 'Курзе с разными начинками — домашняя кавказская кухня с доставкой на дом.' },
  'Узбекские блюда': { h1: 'Узбекские блюда с доставкой', title: 'Узбекская кухня с доставкой в Москве', lead: 'Узбекские блюда на заказ: горячее, которое привозят на дом.' },
  'Выпечка': { h1: 'Выпечка с доставкой', title: 'Выпечка с доставкой на дом в Москве', lead: 'Свежая выпечка к столу — закажите вместе с горячим.' },
  'Супы': { h1: 'Супы с доставкой', title: 'Заказать суп с доставкой на дом в Москве', lead: 'Горячие супы на обед и ужин с доставкой на дом.' },
  'Салаты': { h1: 'Салаты с доставкой', title: 'Салаты с доставкой на дом в Москве', lead: 'Салаты к горячему: закажите всё сразу одним заказом.' },
  'Неаполитанская пицца': { h1: 'Неаполитанская пицца с доставкой', title: 'Заказать пиццу с доставкой на дом в Москве', lead: 'Неаполитанская пицца на тонком тесте с пышными бортиками.' },
  'Десерты': { h1: 'Десерты с доставкой', title: 'Десерты с доставкой на дом в Москве', lead: 'Десерты к чаю и после обеда — добавьте к заказу.' },
  'Соусы': { h1: 'Соусы к блюдам', title: 'Соусы к шашлыку и горячему — заказать с доставкой', lead: 'Соусы, которые хорошо идут к шашлыку, хинкалу и другим блюдам.' },
  'Напитки': { h1: 'Напитки с доставкой', title: 'Напитки с доставкой на дом в Москве', lead: 'Напитки к заказу: добавьте к еде одним заказом.' },
};

const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
function slugify(s) {
  return String(s).toLowerCase().split('').map((c) => (TR[c] !== undefined ? TR[c] : c)).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'menu';
}
const catSlug = (name) => CAT_SLUGS[name] || slugify(name);

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
const money = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + '\u00a0₽';

function cut(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const c = t.slice(0, max - 1);
  return c.slice(0, Math.max(c.lastIndexOf(' '), 40)).replace(/[ ,.;:—-]+$/, '') + '…';
}

module.exports = function setupSeo(app, opts) {
  const SITE = String(opts.siteUrl || '').replace(/\/+$/, '');
  const PUBLIC = opts.publicDir;
  const productsFile = opts.productsFile;
  const BRAND = 'Дачная Беседка';
  const PHONE = '+79670359843';
  const PHONE_VIEW = '+7 (967) 035-98-43';
  const abs = (p) => (/^https?:\/\//.test(p) ? p : SITE + '/' + String(p).replace(/^\/+/, ''));
  const cover = SITE + '/images/og-cover.jpg';

  const priceOf = (p) => (typeof p.price === 'number' ? p.price : null);
  // файл картинки блюда есть на сайте? (если нет — не показываем битую картинку)
  const hasImg = (p) => !!p.image && fs.existsSync(path.join(PUBLIC, String(p.image).replace(/^\/+/, '')));
  const imgTag = (p, extra) => (hasImg(p) ? `<img src="/${esc(p.image)}" alt="${esc(p.name)}"${extra || ''} />` : '<div style="aspect-ratio:4/3;background:#f3f1ec"></div>');

  // картинка для превью в мессенджерах: уменьшенная копия images/og/<имя>, если она есть, иначе исходная
  function ogImage(p) {
    if (!hasImg(p)) return cover;
    const base = path.basename(p.image);
    if (fs.existsSync(path.join(PUBLIC, 'images', 'og', base))) return abs('images/og/' + base);
    return abs(p.image);
  }

  async function catalog() {
    const list = await opts.loadCatalog();
    const cats = [];
    const by = {};
    list.forEach((p) => {
      if (!by[p.category]) { by[p.category] = []; cats.push(p.category); }
      by[p.category].push(p);
    });
    return { list, cats, by };
  }

  function lastmod() {
    try { return fs.statSync(productsFile).mtime.toISOString().slice(0, 10); } catch (e) { return new Date().toISOString().slice(0, 10); }
  }

  function deliveryLine() {
    const km = Math.round((opts.farRadiusM ? opts.farRadiusM() : 4000) / 1000);
    const min = opts.minOrder ? opts.minOrder() : 0;
    return `Доставка по Москве в радиусе ${km} км от нашей кухни, ежедневно с 10:00 до 22:00. Оплата онлайн.` + (min ? ` Минимальный заказ ${money(min)}.` : '');
  }

  const homeTitle = 'Дачная Беседка — доставка шашлыка, хинкала, чуду и пиццы в Москве';
  const homeDesc = 'Закажите еду с доставкой на дом: шашлык, хинкал, чуду, курзе, узбекские блюда и неаполитанская пицца. Доставка по Москве с 10:00 до 22:00, оплата онлайн.';

  function headBlock({ title, desc, url, image, type, noindex, extra }) {
    return [
      `<title>${esc(title)}</title>`,
      `<meta name="description" content="${esc(desc)}" />`,
      noindex ? '<meta name="robots" content="noindex, nofollow" />' : '<meta name="robots" content="index, follow, max-image-preview:large" />',
      `<link rel="canonical" href="${esc(url)}" />`,
      `<meta property="og:site_name" content="${BRAND}" />`,
      `<meta property="og:locale" content="ru_RU" />`,
      `<meta property="og:type" content="${type || 'website'}" />`,
      `<meta property="og:title" content="${esc(title)}" />`,
      `<meta property="og:description" content="${esc(desc)}" />`,
      `<meta property="og:url" content="${esc(url)}" />`,
      `<meta property="og:image" content="${esc(image)}" />`,
      image === cover ? '<meta property="og:image:width" content="1200" />\n<meta property="og:image:height" content="630" />' : '',
      `<meta property="og:image:alt" content="${esc(title)}" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
      `<meta name="twitter:title" content="${esc(title)}" />`,
      `<meta name="twitter:description" content="${esc(desc)}" />`,
      `<meta name="twitter:image" content="${esc(image)}" />`,
      `<meta name="theme-color" content="#152f24" />`,
      extra || '',
    ].filter(Boolean).join('\n');
  }

  function verificationTags() {
    const y = (process.env.YANDEX_VERIFICATION || '').trim();
    const g = (process.env.GOOGLE_VERIFICATION || '').trim();
    return [
      /^[\w-]{6,64}$/.test(y) ? `<meta name="yandex-verification" content="${y}" />` : '',
      /^[\w-]{6,100}$/.test(g) ? `<meta name="google-site-verification" content="${g}" />` : '',
    ].filter(Boolean).join('\n');
  }

  const restaurantLd = () => ({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Restaurant',
        '@id': SITE + '/#restaurant',
        name: BRAND,
        url: SITE + '/',
        image: cover,
        logo: SITE + '/images/logo.png',
        telephone: PHONE,
        description: homeDesc,
        servesCuisine: ['Кавказская кухня', 'Узбекская кухня', 'Пицца'],
        priceRange: '₽₽',
        address: { '@type': 'PostalAddress', addressLocality: 'Москва', addressCountry: 'RU' },
        areaServed: { '@type': 'City', name: 'Москва' },
        openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], opens: '10:00', closes: '22:00' }],
        acceptsReservations: false,
      },
      { '@type': 'WebSite', '@id': SITE + '/#website', url: SITE + '/', name: BRAND, inLanguage: 'ru-RU' },
    ],
  });

  // ---------- Главная: вставляем мета-теги, разметку и ссылки на категории в index.html ----------
  let homeCache = { mtime: 0, html: '' };
  async function homeHtml() {
    const file = path.join(PUBLIC, 'index.html');
    const st = fs.statSync(file);
    if (st.mtimeMs !== homeCache.mtime) homeCache = { mtime: st.mtimeMs, html: fs.readFileSync(file, 'utf-8') };
    let html = homeCache.html;
    let nav = '';
    try {
      const { cats } = await catalog();
      nav = '<span class="fm-title">Меню:</span> ' + cats.map((c) => `<a href="/menu/${catSlug(c)}">${esc((CAT_SEO[c] || {}).h1 || c)}</a>`).join(' · ');
    } catch (e) { /* без списка ссылок тоже работает */ }
    const head = headBlock({ title: homeTitle, desc: homeDesc, url: SITE + '/', image: cover, extra: verificationTags() }) +
      '\n' + ld(restaurantLd()) +
      '\n<style>.footer-menu{max-width:980px;margin:0 auto 14px;padding:0 16px;font-size:13px;line-height:1.9;text-align:center}.footer-menu a{color:inherit;opacity:.75;text-decoration:none;white-space:nowrap}.footer-menu a:hover{opacity:1;text-decoration:underline}.footer-menu .fm-title{opacity:.6}</style>';
    html = html.replace(/<title>[\s\S]*?<\/title>/, head);
    html = html.replace('<!--SEO_NAV-->', nav);
    return html;
  }
  const homeHandler = async (req, res, next) => {
    try {
      res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }).send(await homeHtml());
    } catch (e) { console.error('SEO главная:', e.message); next(); }
  };
  app.get('/', homeHandler);
  app.get('/index.html', homeHandler);

  // ---------- Общий шаблон внутренних страниц ----------
  const css = `*{box-sizing:border-box}body{margin:0;font-family:'Onest',-apple-system,Arial,sans-serif;color:#1e1e1e;background:#fff;line-height:1.5}a{color:#487648}
.hd{background:#152f24;color:#fff}.hd-in{max-width:980px;margin:0 auto;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.hd a{color:#fff;text-decoration:none}.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px}.brand img{width:36px;height:36px;object-fit:contain}
.wrap{max-width:980px;margin:0 auto;padding:18px 16px 40px}.bc{font-size:13px;color:#8a8a8a;margin-bottom:10px}.bc a{color:#8a8a8a}
h1{font-size:28px;line-height:1.2;margin:4px 0 10px}.lead{color:#444;margin:0 0 18px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px}
.card{border:1px solid #ece7de;border-radius:14px;overflow:hidden;background:#fff;display:flex;flex-direction:column}
.card img{width:100%;aspect-ratio:4/3;object-fit:cover;background:#f3f1ec}.card .b{padding:10px 12px 12px;display:flex;flex-direction:column;gap:4px;flex:1}
.card a.t{color:#1e1e1e;text-decoration:none;font-weight:600}.card .m{font-size:13px;color:#8a8a8a}.card .p{font-weight:700;color:#487648;margin-top:auto}
.btn{display:inline-block;background:#ff4b05;color:#fff!important;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:12px}
.btn.g{background:#487648}.old{color:#8a8a8a;text-decoration:line-through;font-weight:400;margin-right:6px}
.dish{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px;align-items:start}@media(max-width:720px){.dish{grid-template-columns:1fr}}
.dish img{width:100%;border-radius:14px;background:#f3f1ec}.price{font-size:26px;font-weight:700;color:#487648;margin:8px 0 14px}
table.v{border-collapse:collapse;margin:6px 0 14px;width:100%}table.v td{padding:7px 0;border-bottom:1px solid #ece7de}table.v td:last-child{text-align:right;font-weight:700;white-space:nowrap}
.note{font-size:14px;color:#555;margin:18px 0}.cats{margin-top:28px;font-size:14px;line-height:2}.cats a{margin-right:12px;white-space:nowrap}
.ft{border-top:1px solid #ece7de;padding:16px;text-align:center;font-size:13px;color:#8a8a8a}.ft a{color:#8a8a8a;margin:0 6px}`;

  function page({ title, desc, url, image, type, body, jsonld, bodyClass }) {
    return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
${headBlock({ title, desc, url, image, type })}
<link rel="icon" type="image/png" href="/images/logo.png" />
<link rel="apple-touch-icon" href="/images/logo.png" />
<link rel="stylesheet" href="/fonts/onest.css" />
<style>${css}</style>
${(jsonld || []).map(ld).join('\n')}
</head>
<body>
<header class="hd"><div class="hd-in"><a class="brand" href="/"><img src="/images/logo.png" alt="Логотип ${BRAND}" /><span>${BRAND}</span></a><a href="tel:${PHONE}">${PHONE_VIEW}</a></div></header>
<main class="wrap">
${body}
</main>
<footer class="ft"><a href="/">Главная и заказ</a><a href="/legal/offer.html">Оферта</a><a href="/legal/privacy-policy.html">Политика конфиденциальности</a></footer>
</body>
</html>`;
  }

  const catLinks = (cats, active) => `<div class="cats"><strong>Всё меню:</strong><br/>${cats.map((c) => `<a href="/menu/${catSlug(c)}"${c === active ? ' style="font-weight:700"' : ''}>${esc((CAT_SEO[c] || {}).h1 || c)}</a>`).join('')}</div>`;

  const notFound = (res) => res.status(404).set('Content-Type', 'text/html; charset=utf-8').send(page({
    title: 'Страница не найдена — ' + BRAND, desc: 'Такой страницы нет. Перейдите в меню.', url: SITE + '/', image: cover,
    body: '<h1>Страницы нет</h1><p class="lead">Возможно, блюдо убрали из меню.</p><p><a class="btn" href="/">Перейти в меню</a></p>',
  }));

  // ---------- Страница категории: /menu/shashlyk ----------
  app.get('/menu/:slug', async (req, res) => {
    try {
      const { cats, by } = await catalog();
      const name = cats.find((c) => catSlug(c) === req.params.slug);
      if (!name) return notFound(res);
      const items = by[name];
      const seo = CAT_SEO[name] || { h1: name, title: `${name} с доставкой в Москве`, lead: '' };
      const prices = items.map(priceOf).filter((n) => n !== null);
      const from = prices.length ? Math.min(...prices) : null;
      const url = `${SITE}/menu/${catSlug(name)}`;
      const names = items.slice(0, 4).map((p) => p.name).join(', ');
      const desc = cut(`${seo.lead} В меню: ${names}${items.length > 4 ? ' и другое' : ''}.` + (from ? ` Цены от ${money(from)}.` : '') + ' Доставка по Москве, оплата онлайн.', 158);
      const cards = items.map((p) => {
        const pr = priceOf(p);
        return `<div class="card"><a href="/dish/${esc(p.id)}">${imgTag(p, ' loading="lazy"')}</a>
<div class="b"><a class="t" href="/dish/${esc(p.id)}">${esc(p.name)}</a>${p.weight ? `<span class="m">${esc(p.weight)}</span>` : ''}
<span class="p">${p.type === 'variant' && pr !== null ? 'от ' : ''}${pr !== null ? money(pr) : 'уточняйте'}</span></div></div>`;
      }).join('\n');
      const body = `<div class="bc"><a href="/">Главная</a> › ${esc(name)}</div>
<h1>${esc(seo.h1)}</h1>
<p class="lead">${esc(seo.lead)} ${esc(deliveryLine())}</p>
<div class="grid">${cards}</div>
<p style="margin-top:22px"><a class="btn" href="/#cat-${encodeURIComponent(String(name).toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-'))}">Заказать на сайте</a></p>
${catLinks(cats, name)}`;
      const jsonld = [
        { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Главная', item: SITE + '/' },
          { '@type': 'ListItem', position: 2, name, item: url }] },
        { '@context': 'https://schema.org', '@type': 'ItemList', name: seo.h1, itemListElement: items.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/dish/${p.id}`, name: p.name })) },
      ];
      res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' })
        .send(page({ title: cut(seo.title + ' | ' + BRAND, 70), desc, url, image: ogImage(items.find(hasImg) || {}), body, jsonld }));
    } catch (e) { console.error('SEO категория:', e.message); res.status(500).send('Ошибка'); }
  });

  // ---------- Страница блюда: /dish/shashlyk-lamb ----------
  app.get('/dish/:id', async (req, res) => {
    try {
      const { list, cats, by } = await catalog();
      const p = list.find((x) => x.id === req.params.id);
      if (!p) return notFound(res);
      const url = `${SITE}/dish/${p.id}`;
      const pr = priceOf(p);
      const seo = CAT_SEO[p.category] || {};
      const lower = String(p.category).toLowerCase();
      const text = (p.description && p.description.trim()) ||
        `${p.name} — ${lower} с доставкой по Москве.` + (p.weight ? ` Вес: ${p.weight}.` : '') + ' Готовим в «Дачной Беседке» и привозим на дом.';
      const lead = `${p.name}` + (p.weight ? `, ${p.weight}` : '') + (pr !== null ? ` — ${p.type === 'variant' ? 'от ' : ''}${money(pr)}` : '') + '.';
      const tail = ' Доставка по Москве.';
      let descBody = cut(text, Math.max(40, 158 - lead.length - tail.length - 2));
      if (!/[.!?…]$/.test(descBody)) descBody += '.';
      const desc = lead + ' ' + descBody + tail;
      const avail = p.stop ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock';
      const mkOffer = (name, price) => ({ '@type': 'Offer', ...(name ? { name } : {}), url, priceCurrency: 'RUB', price: String(price), availability: avail, itemCondition: 'https://schema.org/NewCondition' });
      let offers = null;
      if (Array.isArray(p.variants) && p.variants.length) offers = p.variants.filter((v) => typeof v.price === 'number').map((v) => mkOffer(v.label, v.price));
      else if (pr !== null) offers = mkOffer(null, pr);
      const prod = { '@context': 'https://schema.org', '@type': 'Product', name: p.name, description: text, image: [ogImage(p)], category: p.category, brand: { '@type': 'Brand', name: BRAND } };
      if (offers && (!Array.isArray(offers) || offers.length)) prod.offers = offers;
      const jsonld = [
        { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Главная', item: SITE + '/' },
          { '@type': 'ListItem', position: 2, name: p.category, item: `${SITE}/menu/${catSlug(p.category)}` },
          { '@type': 'ListItem', position: 3, name: p.name, item: url }] },
        prod,
      ];
      const variantsHtml = Array.isArray(p.variants) && p.variants.length
        ? `<table class="v">${p.variants.map((v) => `<tr><td>${esc(v.label)}</td><td>${typeof v.price === 'number' ? money(v.price) : ''}</td></tr>`).join('')}</table>` : '';
      const optionsHtml = Array.isArray(p.options) && p.options.length
        ? `<p class="note"><strong>На выбор:</strong> ${esc(p.options.map((o) => o.name).filter(Boolean).join(', '))}.</p>` : '';
      const priceHtml = pr === null ? '<div class="price">Цену уточняйте</div>'
        : `<div class="price">${p.oldPrice && p.oldPrice > pr ? `<span class="old">${money(p.oldPrice)}</span>` : ''}${p.type === 'variant' ? 'от ' : ''}${money(pr)}</div>`;
      const same = (by[p.category] || []).filter((x) => x.id !== p.id).slice(0, 4);
      const more = same.length ? `<h2 style="font-size:20px;margin:30px 0 12px">Ещё из раздела «${esc(p.category)}»</h2><div class="grid">${same.map((x) => `<div class="card"><a href="/dish/${esc(x.id)}">${imgTag(x, ' loading="lazy"')}</a><div class="b"><a class="t" href="/dish/${esc(x.id)}">${esc(x.name)}</a><span class="p">${priceOf(x) !== null ? money(priceOf(x)) : ''}</span></div></div>`).join('')}</div>` : '';
      const body = `<div class="bc"><a href="/">Главная</a> › <a href="/menu/${catSlug(p.category)}">${esc(p.category)}</a> › ${esc(p.name)}</div>
<div class="dish">
<div>${hasImg(p) ? imgTag(p) : ''}</div>
<div>
<h1>${esc(p.name)}</h1>
${p.weight ? `<div class="m" style="color:#8a8a8a">${esc(p.weight)}</div>` : ''}
${priceHtml}${variantsHtml}
<p>${esc(text)}</p>${optionsHtml}
${p.stop ? '<p class="note"><strong>Сейчас нет в наличии.</strong> Загляните позже.</p>' : `<p><a class="btn" href="/?dish=${encodeURIComponent(p.id)}">Заказать</a></p>`}
<p class="note">${esc(deliveryLine())}</p>
</div></div>
${more}
${catLinks(cats, p.category)}`;
      res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' })
        .send(page({ title: (`${p.name} — заказать с доставкой в Москве | ${BRAND}`.length <= 70 ? `${p.name} — заказать с доставкой в Москве | ${BRAND}` : cut(`${p.name} — заказать с доставкой в Москве`, 70)), desc, url, image: ogImage(p), type: 'product', body, jsonld }));
    } catch (e) { console.error('SEO блюдо:', e.message); res.status(500).send('Ошибка'); }
  });

  // ---------- Карта сайта: все страницы, обновляется сама при изменении меню ----------
  app.get('/sitemap.xml', async (req, res) => {
    try {
      const { list, cats } = await catalog();
      const d = lastmod();
      const urls = [SITE + '/', ...cats.map((c) => `${SITE}/menu/${catSlug(c)}`), ...list.map((p) => `${SITE}/dish/${p.id}`),
        SITE + '/legal/offer.html', SITE + '/legal/privacy-policy.html', SITE + '/legal/consent.html'];
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        urls.map((u) => `  <url><loc>${esc(u)}</loc><lastmod>${d}</lastmod></url>`).join('\n') + '\n</urlset>\n';
      res.set({ 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }).send(xml);
    } catch (e) { console.error('SEO sitemap:', e.message); res.status(500).send('Ошибка'); }
  });

  // ---------- robots.txt (читаем из public/robots.txt, адрес карты сайта берём из SITE_URL) ----------
  app.get('/robots.txt', (req, res) => {
    const txt = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin-orders.html
Disallow: /order-success.html
Clean-param: dish /

Sitemap: ${SITE}/sitemap.xml
`;
    res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }).send(txt);
  });

  // Админку и страницу «спасибо за заказ» просим не показывать в поиске
  const noindex = (req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); };
  app.get('/admin-orders.html', noindex);
  app.get('/order-success.html', noindex);
};

module.exports.catSlug = catSlug;
