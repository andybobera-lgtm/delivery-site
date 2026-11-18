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
  const imgTag = (p, extra) => (hasImg(p) ? `<img src="/${esc(p.image)}" alt="${esc(p.name)}"${extra || ''} />` : '<div class="ph" role="img" aria-label="' + esc(p.name) + '"></div>');

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
      { '@type': 'WebSite', '@id': SITE + '/#website', url: SITE + '/', name: BRAND, alternateName: ['Дачная беседка', 'Dachnaya Besedka'], inLanguage: 'ru-RU' },
    ],
  });

  // ---------- Главная: вставляем мета-теги, разметку и ссылки на категории в index.html ----------
  let homeCache = { mtime: 0, html: '' };
  function rawHome() {
    const file = path.join(PUBLIC, 'index.html');
    const st = fs.statSync(file);
    if (st.mtimeMs !== homeCache.mtime) homeCache = { mtime: st.mtimeMs, html: fs.readFileSync(file, 'utf-8') };
    return homeCache.html;
  }
  const FOOTER_NAV_CSS = '.footer-menu{max-width:980px;margin:0 auto 14px;padding:0 16px;font-size:13px;line-height:1.9;text-align:center}.footer-menu a{color:inherit;opacity:.75;text-decoration:none;white-space:nowrap}.footer-menu a:hover{opacity:1;text-decoration:underline}.footer-menu .fm-title{opacity:.6}';
  async function homeHtml() {
    let html = rawHome();
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
  const css = `*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;font-family:'Onest',-apple-system,Arial,sans-serif;color:#1e1e1e;background:#fcf8ee;line-height:1.45;-webkit-font-smoothing:antialiased}a{color:inherit}
.hd{position:sticky;top:0;z-index:20;background:#fff;border-bottom:1px solid #ece7de}
.hd-in{max-width:1240px;margin:0 auto;padding:8px 20px;display:flex;align-items:center;gap:16px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px;text-decoration:none;margin-right:auto}.brand img{height:48px;width:auto;object-fit:contain}
.hd-phone{text-decoration:none;font-weight:600;font-size:15px}
.hd-cta{background:#ff4b05;color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:14px;font-size:15px;white-space:nowrap}
.wrap{max-width:1240px;margin:0 auto;padding:18px 20px 110px}
.back{display:inline-flex;align-items:center;gap:8px;background:#f1ece0;color:#1e1e1e;text-decoration:none;font-weight:600;font-size:15px;padding:9px 16px 9px 10px;border-radius:999px;margin:2px 8px 6px 0}.back:hover{background:#e9e2d2}.back .bi{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:#fff;font-size:16px;line-height:1}
h1{font-size:clamp(30px,5vw,52px);line-height:1.05;font-weight:800;text-transform:uppercase;letter-spacing:-.01em;margin:6px 0 12px}
.lead{color:#5b5850;margin:0 0 18px;max-width:780px;font-size:15px}
.pills{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;margin:0 -20px 8px;padding:2px 20px 12px;-webkit-overflow-scrolling:touch}.pills::-webkit-scrollbar{display:none}
.pill{flex:0 0 auto;padding:9px 16px;border-radius:999px;background:#f1ece0;font-size:14px;font-weight:600;text-decoration:none;color:#1e1e1e;white-space:nowrap}.pill:hover{background:#e9e2d2}.pill.on{background:#1e1e1e;color:#fff}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:34px 20px;margin-top:10px}
.card{display:flex;flex-direction:column;min-width:0}
.card .pic{display:block;margin-bottom:10px;border-radius:16px;overflow:hidden;background:#efe6d3}
.card img,.card .ph{width:100%;aspect-ratio:1/1;object-fit:cover;display:block;transition:transform .35s ease}.card .pic:hover img{transform:scale(1.03)}
.ph{background:linear-gradient(135deg,#efe6d3,#e4d8bf)}
.card .t{font-weight:600;font-size:17px;text-decoration:none;line-height:1.25}.card .t:hover{text-decoration:underline}
.card .m{font-size:12px;color:#8a8a8a;margin:2px 0 4px}
.card .d{font-size:13px;color:#777;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin:0 0 10px}
.card .buy{margin-top:auto;padding-top:4px}
.pbtn{display:inline-flex;align-items:center;gap:8px;background:#487648;color:#fff!important;text-decoration:none;font-weight:700;font-size:14px;padding:9px 14px;border-radius:12px;transition:background .2s}.pbtn:hover{background:#395f39}
.pbtn.o{background:#ff4b05;font-size:17px;padding:15px 28px;border-radius:16px;box-shadow:0 8px 20px rgba(241,90,36,.3)}.pbtn.o:hover{background:#e84300}
.old{color:#8a8a8a;text-decoration:line-through;font-weight:400;margin-right:6px}
.dish{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:40px;align-items:start;margin-top:8px}
.dish.nophoto{grid-template-columns:1fr;max-width:760px}.dimg img,.dimg .ph{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:22px;display:block;background:#efe6d3}
.dinfo .w{color:#8a8a8a;margin:0 0 6px}.price{font-size:30px;font-weight:800;margin:8px 0 16px}
.dtext{font-size:16px;color:#3b3934;margin:0 0 14px}
table.v{border-collapse:collapse;margin:6px 0 16px;width:100%;background:#fff;border-radius:14px;overflow:hidden}table.v td{padding:12px 16px;border-bottom:1px solid #f0eadc}table.v tr:last-child td{border-bottom:none}table.v td:last-child{text-align:right;font-weight:700;white-space:nowrap}
.note{font-size:14px;color:#6b685f;margin:16px 0}
h2.more{font-size:24px;font-weight:800;text-transform:uppercase;margin:44px 0 6px}
.ft{border-top:1px solid #ece7de;padding:18px;text-align:center;font-size:13px;color:#8a8a8a;background:#fff}.ft a{color:#8a8a8a;margin:0 8px;text-decoration:none}.ft a:hover{text-decoration:underline}
.sticky{display:none}
@media(max-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:26px 14px}.dish{grid-template-columns:1fr;gap:20px}.card .t{font-size:15px}}
@media(max-width:720px){.wrap{padding:14px 16px 110px}.pills{margin:0 -16px 6px;padding:2px 16px 12px}.hd-phone,.hd-cta{display:none}.hd-in{padding:6px 16px}.brand img{height:42px}.brand{font-size:16px}
.sticky{display:block;position:fixed;left:0;right:0;bottom:0;z-index:30;padding:22px 14px calc(12px + env(safe-area-inset-bottom));background:linear-gradient(to top,#fcf8ee 62%,rgba(252,248,238,0))}
.sticky a{display:block;text-align:center;background:#ff4b05;color:#fff;font-weight:700;font-size:17px;padding:16px;border-radius:16px;text-decoration:none;box-shadow:0 8px 20px rgba(241,90,36,.35)}}`;

  function page({ title, desc, url, image, type, body, jsonld, sticky }) {
    const st = sticky || { href: '/', label: 'Перейти к заказу →' };
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
<header class="hd"><div class="hd-in"><a class="brand" href="/"><img src="/images/logo.png" alt="Логотип ${BRAND}" /><span>${BRAND}</span></a><a class="hd-phone" href="tel:${PHONE}">${PHONE_VIEW}</a><a class="hd-cta" href="/">Перейти к заказу</a></div></header>
<main class="wrap">
${body}
</main>
<footer class="ft"><p style="margin:0 0 8px"><a href="/">Главная и заказ</a></p><p style="margin:0"><a href="/legal/privacy-policy.html">Политика конфиденциальности</a> · <a href="/legal/privacy-policy.html">Политика cookie</a> · <a href="/legal/consent.html">Согласие на обработку персональных данных</a> · <a href="/legal/offer.html">Пользовательское соглашение (договор оферты)</a></p></footer>
<div class="sticky"><a href="${esc(st.href)}">${esc(st.label)}</a></div>
</body>
</html>`;
  }

  // полоска категорий (обычные ссылки — их видят и люди, и поисковики)
  const pills = (cats, active) => `<nav class="pills" aria-label="Меню">${cats.map((c) => `<a class="pill${c === active ? ' on' : ''}" href="/menu/${catSlug(c)}">${esc(c)}</a>`).join('')}</nav>`;

  // карточка блюда: фото и название ведут на страницу блюда, кнопка с ценой — в заказ на главной
  const cardHtml = (p, withDesc) => {
    const pr = priceOf(p);
    const id = esc(p.id);
    const btn = p.stop ? '<span class="m">Сейчас нет в наличии</span>'
      : pr === null ? '<span class="m">Цену уточняйте</span>'
        : `<a class="pbtn" href="/?dish=${encodeURIComponent(p.id)}" rel="nofollow">${p.oldPrice && p.oldPrice > pr ? `<span class="old" style="color:#d6e3d6">${money(p.oldPrice)}</span>` : ''}${p.type === 'variant' ? 'от ' : ''}${money(pr)} <span aria-hidden="true">→</span></a>`;
    return `<article class="card"><a class="pic" href="/dish/${id}">${imgTag(p, ' loading="lazy"')}</a>
<a class="t" href="/dish/${id}">${esc(p.name)}</a>${p.weight ? `<div class="m">${esc(p.weight)}</div>` : ''}${withDesc && p.description ? `<p class="d">${esc(p.description)}</p>` : ''}
<div class="buy">${btn}</div></article>`;
  };


  const notFound = (res) => res.status(404).set('Content-Type', 'text/html; charset=utf-8').send(page({
    title: 'Страница не найдена — ' + BRAND, desc: 'Такой страницы нет. Перейдите в меню.', url: SITE + '/', image: cover,
    body: '<h1>Страницы нет</h1><p class="lead">Возможно, блюдо убрали из меню.</p><p><a class="btn" href="/">Перейти в меню</a></p>',
  }));

  // ---------- Страница категории: /menu/shashlyk ----------
  // Это та же страница сайта (с корзиной и окнами блюд), но показывает только одну категорию:
  // добавлять в корзину можно прямо здесь, без перехода на главную.
  const CAT_CSS = `body.cat-page{background:#fcf8ee}
.cat-page .promo-slider,.cat-page .category-nav-row{display:none!important}
.cat-intro{max-width:1100px;margin:0 auto;padding:18px 20px 20px}
.cat-intro .back,.cat-more .back{display:inline-flex;align-items:center;gap:8px;background:#f1ece0;color:#1e1e1e;text-decoration:none;font-weight:600;font-size:15px;padding:9px 16px 9px 10px;border-radius:999px}
.cat-intro .back:hover{background:#e9e2d2}.cat-intro .bi{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:#fff;font-size:16px;line-height:1}
.cat-intro h1{font-size:clamp(30px,5vw,52px);line-height:1.05;font-weight:800;text-transform:uppercase;letter-spacing:-.01em;margin:14px 0 12px}
.cat-intro .lead{color:#5b5850;margin:0;max-width:780px;font-size:15px;line-height:1.5}
.cat-page .menu-wrap{padding-top:18px}
.cat-more{max-width:1100px;margin:10px auto 40px;padding:0 20px}
.cat-more h2{font-size:22px;font-weight:800;text-transform:uppercase;margin:0 0 12px}
.cat-more nav{display:flex;flex-wrap:wrap;gap:8px}
.cat-more nav a{padding:9px 16px;border-radius:999px;background:#f1ece0;font-size:14px;font-weight:600;text-decoration:none;color:#1e1e1e}.cat-more nav a:hover{background:#e9e2d2}
.cat-more p{font-size:14px;color:#6b685f;margin:16px 0 0;line-height:1.5}
@media(max-width:720px){.cat-intro{padding:14px 16px 16px}.cat-more{padding:0 16px}}`;

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
      const jsonld = [
        { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Главная', item: SITE + '/' },
          { '@type': 'ListItem', position: 2, name, item: url }] },
        { '@context': 'https://schema.org', '@type': 'ItemList', name: seo.h1, itemListElement: items.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/dish/${p.id}`, name: p.name })) },
      ];
      const title = cut(seo.title + ' | ' + BRAND, 70);
      const head = headBlock({ title, desc, url, image: ogImage(items.find(hasImg) || {}), extra: verificationTags() }) +
        '\n<base href="/" />\n' + jsonld.map(ld).join('\n') + `\n<style>${FOOTER_NAV_CSS}${CAT_CSS}</style>`;
      const nav = '<span class="fm-title">Меню:</span> ' + cats.map((c) => `<a href="/menu/${catSlug(c)}">${esc((CAT_SEO[c] || {}).h1 || c)}</a>`).join(' · ');
      const intro = `<section class="cat-intro"><a class="back" href="/"><span class="bi" aria-hidden="true">⌂</span>На главную</a>
<h1>${esc(seo.h1)}</h1>
<p class="lead">${esc(seo.lead)} ${esc(deliveryLine())}</p></section>`;
      const others = cats.filter((c) => c !== name);
      const more = `<section class="cat-more"><h2>Другие разделы меню</h2><nav aria-label="Другие разделы">${others.map((c) => `<a href="/menu/${catSlug(c)}">${esc(c)}</a>`).join('')}</nav>
<p>${esc(deliveryLine())}</p></section>`;
      const fallback = `<noscript><ul>${items.map((p) => `<li><a href="/dish/${esc(p.id)}">${esc(p.name)}</a>${priceOf(p) !== null ? ' — ' + (p.type === 'variant' ? 'от ' : '') + money(priceOf(p)) : ''}${p.description ? '. ' + esc(p.description) : ''}</li>`).join('')}</ul></noscript>`;

      let html = rawHome();
      html = html.replace(/<title>[\s\S]*?<\/title>/, head)
        .replace('<body>', '<body class="cat-page">')
        .replace('</header>', '</header>\n' + intro)
        .replace('<div id="menu-sections">Загрузка меню...</div>', `<div id="menu-sections">${fallback}</div>`)
        .replace('<footer class="footer">', more + '\n<footer class="footer">')
        .replace('<!--SEO_NAV-->', nav)
        .replace('<script src="script.js"></script>', `<script>window.ONLY_CATEGORY=${JSON.stringify(name).replace(/</g, '\\u003c')};</script>\n<script src="script.js"></script>`);
      res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }).send(html);
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
      const same = (by[p.category] || []).filter((x) => x.id !== p.id).slice(0, 6);
      const more = same.length ? `<h2 class="more">Ещё из раздела «${esc(p.category)}»</h2><div class="grid">${same.map((x) => cardHtml(x, false)).join('')}</div>` : '';
      const orderHref = `/?dish=${encodeURIComponent(p.id)}`;
      const canOrder = !p.stop && pr !== null;
      const body = `<a class="back" href="/menu/${catSlug(p.category)}"><span class="bi" aria-hidden="true">‹</span>${esc(p.category)}</a><a class="back" href="/"><span class="bi" aria-hidden="true">⌂</span>На главную</a>
<div class="dish${hasImg(p) ? '' : ' nophoto'}">
${hasImg(p) ? `<div class="dimg">${imgTag(p)}</div>` : ''}
<div class="dinfo">
<h1>${esc(p.name)}</h1>
${p.weight ? `<p class="w">${esc(p.weight)}</p>` : ''}
${priceHtml}${variantsHtml}
<p class="dtext">${esc(text)}</p>${optionsHtml}
${p.stop ? '<p class="note"><strong>Сейчас нет в наличии.</strong> Загляните позже.</p>' : (canOrder ? `<p><a class="pbtn o" href="${orderHref}" rel="nofollow">Заказать</a></p>` : '<p><a class="pbtn o" href="/">Перейти в меню</a></p>')}
<p class="note">${esc(deliveryLine())}</p>
</div></div>
${more}`;
      const sticky = canOrder ? { href: orderHref, label: `Заказать — ${p.type === 'variant' ? 'от ' : ''}${money(pr)}` } : { href: '/', label: 'Перейти к заказу →' };
      res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' })
        .send(page({ title: (`${p.name} — заказать с доставкой в Москве | ${BRAND}`.length <= 70 ? `${p.name} — заказать с доставкой в Москве | ${BRAND}` : cut(`${p.name} — заказать с доставкой в Москве`, 70)), desc, url, image: ogImage(p), type: 'product', body, jsonld, sticky }));
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
