// ==========================================================================
// СЕРВЕР САЙТА ДОСТАВКИ
// Что делает этот файл:
// 1) Отдаёт посетителям страницы сайта (папка public)
// 2) Отдаёт список товаров (/api/products)
// 3) Принимает заказ, создаёт платёж в ЮKassa и отправляет ссылку на оплату
// 4) Принимает от ЮKassa уведомление, что оплата прошла, и помечает заказ оплаченным
// ==========================================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { notifyPaidOrder } = require('./notify');
const yd = require('./yandex-delivery');

const SITE_URL = process.env.SITE_URL || 'http://localhost:3000';
const IS_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(SITE_URL);

const app = express();
app.disable('x-powered-by');   // не сообщаем всем, на чём написан сайт
app.set('trust proxy', 1);

// ---------- Защита: HTTPS и заголовки безопасности ----------
app.use((req, res, next) => {
  // Если зашли по http (не https) — перенаправляем на https (только для обычных страниц; вебхук ЮKassa не трогаем)
  const proto = req.get('x-forwarded-proto');
  if (proto === 'http' && !IS_LOCAL && (req.method === 'GET' || req.method === 'HEAD')) {
    return res.redirect(301, 'https://' + req.get('host') + req.originalUrl);
  }
  if (proto === 'https') res.set('Strict-Transport-Security', 'max-age=15552000'); // 180 дней: браузер сам будет ходить по https
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=()');
  // Часть политики CSP: запрещаем встраивать сайт в чужие страницы, чужие <base> и формы, плагины.
  // (Полный запрет сторонних скриптов не включаем: Яндекс.Карты требуют широких разрешений.)
  res.set('Content-Security-Policy', "frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'");
  next();
});

// ---------- Защита: CORS (запросы с других сайтов не принимаем) ----------
let siteOrigin = '';
try { siteOrigin = new URL(SITE_URL).origin; } catch (e) {}
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || origin === siteOrigin || (IS_LOCAL && /^https?:\/\/(localhost|127\.0\.0\.1)/.test(origin))),
}));

app.use(express.json({ limit: '50kb' }));

// ---------- Защита: ограничение числа запросов ----------
function clientIp(req) {
  const xff = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || req.socket.remoteAddress || 'unknown';
}
function makeLimiter(windowMs, max) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset <= now) hits.delete(k); }, windowMs).unref();
  return function limiter(req, res, next) {
    const now = Date.now();
    const ip = clientIp(req);
    let h = hits.get(ip);
    if (!h || h.reset <= now) { h = { n: 0, reset: now + windowMs }; hits.set(ip, h); }
    h.n += 1;
    if (h.n > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ error: 'Слишком много запросов. Подождите немного и повторите.' });
    }
    next();
  };
}
app.use('/api/', makeLimiter(60 * 1000, 300));                       // всего: 300 запросов в минуту с одного адреса
const orderLimiter = makeLimiter(10 * 60 * 1000, 15);                // создание заказов: 15 за 10 минут

// SEO: главная с мета-тегами, страницы /menu/... и /dish/..., sitemap.xml и robots.txt (подключаем ДО раздачи файлов из public)
require('./seo')(app, {
  siteUrl: SITE_URL,
  publicDir: path.join(__dirname, 'public'),
  productsFile: path.join(__dirname, 'products.json'),
  loadCatalog: () => loadCatalog(),
  minOrder: () => MIN_ORDER,
  farRadiusM: () => FAR_RADIUS_M,
});

app.use(express.static(path.join(__dirname, 'public'), {
  dotfiles: 'ignore',
  setHeaders: (res, filePath) => {
    // картинки можно ненадолго запоминать в браузере — сайт быстрее; страницы, стили и скрипты — всегда свежие
    if (/\.(jpg|jpeg|png|webp|svg|woff2?)$/i.test(filePath)) res.set('Cache-Control', 'public, max-age=3600');
  },
}));
app.use('/legal', express.static(path.join(__dirname, 'legal'), { dotfiles: 'ignore' }));

const PRODUCTS_FILE = path.join(__dirname, 'products.json');

const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;

// Условия доставки (можно поменять здесь или через переменные окружения)
const MIN_ORDER = Number(process.env.MIN_ORDER) || 1000;            // минимальная сумма заказа, ₽
const DELIVERY_FEE = Number(process.env.DELIVERY_FEE) || 250;       // стоимость доставки, ₽
const FREE_DELIVERY_FROM = Number(process.env.FREE_DELIVERY_FROM) || 3000; // от этой суммы действует сниженная цена доставки, ₽

// Две зоны доставки (расстояние по прямой от кулинарной лавки):
//   ближняя — до NEAR_RADIUS_M: DELIVERY_FEE, а от FREE_DELIVERY_FROM — бесплатно;
//   дальняя — до FAR_RADIUS_M:  DELIVERY_FEE_FAR, а от FREE_DELIVERY_FROM — DELIVERY_FEE_FAR_DISCOUNT.
function envNum(name, def) { const v = process.env[name]; return v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : def; }
const NEAR_RADIUS_M = envNum('NEAR_RADIUS_M', 2000);
const FAR_RADIUS_M = envNum('FAR_RADIUS_M', 4000);
const DELIVERY_FEE_FAR = envNum('DELIVERY_FEE_FAR', 500);
const DELIVERY_FEE_FAR_DISCOUNT = envNum('DELIVERY_FEE_FAR_DISCOUNT', 200);
const KITCHEN_COORDS = [55.673030, 37.614196]; // кулинарная лавка «Дачная беседка» [широта, долгота]

// Расстояние между двумя точками по прямой, метры. Та же формула стоит в браузере (script.js),
// поэтому цена, которую человек видит в корзине, совпадает с ценой, которую считает сервер.
function distanceM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function deliveryFeeFor(zone, subtotal) {
  const reduced = subtotal >= FREE_DELIVERY_FROM;
  if (zone === 'far') return reduced ? DELIVERY_FEE_FAR_DISCOUNT : DELIVERY_FEE_FAR;
  return reduced ? 0 : DELIVERY_FEE;
}

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// Данные для входа в ЮKassa
function yookassaAuth() {
  return 'Basic ' + Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString('base64');
}

// ---------- Проверка настроек при запуске (секреты в логи не пишем) ----------
function checkEnv() {
  const problems = [];
  if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) problems.push('не заданы YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY — оплата работать не будет');
  if (!process.env.ADMIN_KEY) problems.push('не задан ADMIN_KEY — вход в админ-панель закрыт');
  else if (process.env.ADMIN_KEY.length < 12) problems.push('ADMIN_KEY короче 12 символов — задайте длиннее (лучше 16+ букв и цифр)');
  if (!IS_LOCAL && !/^https:\/\//.test(SITE_URL)) problems.push('SITE_URL должен начинаться с https://');
  if (!process.env.DATABASE_URL) problems.push('не задан DATABASE_URL — заказы пропадут при перезапуске');
  problems.forEach((p) => console.warn('⚠ Настройки: ' + p));
}

// ---------- Вход в админ-панель ----------
// Пароль передаётся в заголовке X-Admin-Key (не в адресе страницы, чтобы он не попадал в журналы).
// Сравниваем "в постоянное время" по хэшам — по скорости ответа пароль не подобрать.
function sha256(x) { return crypto.createHash('sha256').update(String(x)).digest(); }
function adminKeyOk(key) {
  const real = process.env.ADMIN_KEY;
  if (!real || typeof key !== 'string' || !key) return false;
  return crypto.timingSafeEqual(sha256(key), sha256(real));
}
// Защита от подбора пароля: 10 неверных попыток подряд — блок этого адреса на 15 минут
const adminFails = new Map();
const FAIL_LIMIT = 10, FAIL_WINDOW = 15 * 60 * 1000;
function adminAuth(req, res, next) {
  const ip = clientIp(req);
  const now = Date.now();
  const f = adminFails.get(ip);
  if (f && f.until > now) {
    res.set('Retry-After', String(Math.ceil((f.until - now) / 1000)));
    return res.status(429).json({ error: 'Слишком много неверных попыток. Попробуйте позже.' });
  }
  if (adminKeyOk(req.get('x-admin-key'))) { adminFails.delete(ip); return next(); }
  const cur = f && f.reset > now ? f : { n: 0, reset: now + FAIL_WINDOW, until: 0 };
  cur.n += 1;
  if (cur.n >= FAIL_LIMIT) cur.until = now + FAIL_WINDOW;
  adminFails.set(ip, cur);
  return res.status(401).json({ error: 'Неверный пароль' });
}
setInterval(() => { const now = Date.now(); for (const [k, v] of adminFails) if (v.reset <= now && v.until <= now) adminFails.delete(k); }, 60 * 1000).unref();

// ---------- Проверка присланных данных ----------
// Чистим строку: только текст, без управляющих символов, с ограничением длины
function cleanStr(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}
function toInt(v, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- Проверка: где хранятся заказы (откройте адрес-сайта/api/health) ---
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ordersStorage: db.getMode() });
});

// --- Условия доставки для сайта (корзина берёт отсюда цифры) ---
app.get('/api/config', (req, res) => {
  res.json({
    minOrder: MIN_ORDER, deliveryFee: DELIVERY_FEE, freeDeliveryFrom: FREE_DELIVERY_FROM,
    farFee: DELIVERY_FEE_FAR, farFeeFree: DELIVERY_FEE_FAR_DISCOUNT,
    nearRadius: NEAR_RADIUS_M, farRadius: FAR_RADIUS_M,
  });
});

// --- Каталог с учётом стоп-листа и правок КБЖУ из админ-панели ---
// Стоп можно задать двумя способами: переключателем в админ-панели (хранится в базе)
// или строкой "stop": true в products.json. Переключатель в админке главнее.
function round1(v) { return Math.round(v * 10) / 10; }
function withPer100(nutrition, per100) {
  const w = (nutrition && nutrition.perPortion && nutrition.perPortion.weight) || 0;
  const k = w / 100;
  const out = { per100: { kcal: per100.kcal, protein: per100.protein, fat: per100.fat, carbs: per100.carbs } };
  if (w > 0) out.perPortion = { weight: w, kcal: round1(per100.kcal * k), protein: round1(per100.protein * k), fat: round1(per100.fat * k), carbs: round1(per100.carbs * k) };
  return out;
}
// Вес порции из текста вроде «500 г» или «1.36 кг» (нужен, если у блюда КБЖУ в файле не задано, а в админке введено)
function weightFromText(text) {
  const m = String(text || '').replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(кг|мл|г|л)(?![а-яёa-z])/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  return Math.round(/^(кг|л)$/i.test(m[2]) ? n * 1000 : n);
}
async function loadCatalog() {
  const products = readJSON(PRODUCTS_FILE);
  let stops = {}, nuts = {}, prices = {};
  try { prices = await db.getPriceOverrides(); } catch (e) { console.error('Цены из админки не прочитаны:', e.message); }
  try { stops = await db.getStopOverrides(); } catch (e) { console.error('Стоп-лист не прочитан:', e.message); }
  try { nuts = await db.getNutritionOverrides(); } catch (e) { console.error('КБЖУ не прочитано:', e.message); }
  return products.map((p) => {
    const q = { ...p, stop: Object.prototype.hasOwnProperty.call(stops, p.id) ? !!stops[p.id] : !!p.stop };
    // Цены, которые повар поменял в админ-панели, главнее цен из products.json
    if (Number.isInteger(prices[p.id + '|']) && !Array.isArray(q.variants)) {
      q.price = prices[p.id + '|'];
      if (q.oldPrice && q.oldPrice <= q.price) delete q.oldPrice; // зачёркнутая «старая» цена не должна быть ниже новой
    }
    if (Array.isArray(q.variants)) {
      q.variants = q.variants.map((v) => (Number.isInteger(prices[p.id + '|' + v.id]) ? { ...v, price: prices[p.id + '|' + v.id] } : v));
      // общая цена блюда с вариантами повторяет первый вариант (как и в products.json)
      if (q.variants[0] && Number.isInteger(prices[p.id + '|' + q.variants[0].id])) q.price = q.variants[0].price;
    }
    if (nuts[p.id + '|'] && !Array.isArray(q.variants)) {
      q.nutrition = withPer100(q.nutrition || { perPortion: { weight: weightFromText(p.weight) } }, nuts[p.id + '|']);
    }
    if (Array.isArray(q.variants)) {
      q.variants = q.variants.map((v) => (nuts[p.id + '|' + v.id] && v.nutrition ? { ...v, nutrition: withPer100(v.nutrition, nuts[p.id + '|' + v.id]) } : v));
      // у блюд с вариантами общий КБЖУ повторяет первый вариант
      if (q.variants[0] && q.variants[0].nutrition && nuts[p.id + '|' + q.variants[0].id]) q.nutrition = q.variants[0].nutrition;
    }
    return q;
  });
}

// --- Отдаём каталог товаров (блюда на стопе не показываем) ---
app.get('/api/products', async (req, res) => {
  try {
    const catalog = await loadCatalog();
    res.json(catalog.filter((p) => !p.stop).map(({ stop, ...rest }) => rest));
  } catch (err) {
    console.error('Ошибка каталога:', err.message);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// --- Приём нового заказа ---
app.post('/api/orders', orderLimiter, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { items, customer: rawCustomer } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Корзина пуста' });
    }
    if (items.length > 40) {
      return res.status(400).json({ error: 'Слишком много позиций в заказе' });
    }

    // Данные покупателя: берём только нужные поля, проверяем тип и длину
    const rc = rawCustomer && typeof rawCustomer === 'object' ? rawCustomer : {};
    const customer = {
      name: cleanStr(rc.name, 80),
      phone: cleanStr(rc.phone, 30),
      address: cleanStr(rc.address, 300),
      comment: cleanStr(rc.comment, 600),
    };
    if (!customer.name || !customer.phone || !customer.address) {
      return res.status(400).json({ error: 'Не заполнены данные покупателя' });
    }
    // Точка доставки на карте: по ней сервер сам определяет зону и цену доставки и не принимает адреса вне зоны
    const g = body.geo && typeof body.geo === 'object' ? body.geo : null;
    const lat = g ? Number(g.lat) : NaN, lon = g ? Number(g.lon) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return res.status(400).json({ error: 'Отметьте адрес доставки точкой на карте' });
    }
    const geo = { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
    const distance = distanceM([geo.lat, geo.lon], KITCHEN_COORDS);
    if (distance > FAR_RADIUS_M) {
      return res.status(400).json({ error: `Адрес не входит в зону доставки (до ${FAR_RADIUS_M / 1000} км)` });
    }
    const deliveryZone = distance <= NEAR_RADIUS_M ? 'near' : 'far';

    // Согласие на обработку персональных данных — отдельная отметка (ст. 9 152-ФЗ)
    if (body.consentPd !== true) {
      return res.status(400).json({ error: 'Нужно дать согласие на обработку персональных данных' });
    }
    const cutleryCount = toInt(body.cutleryCount, 0, 20) ?? 0;

    // Приводим телефон к формату, который требует ЮKassa: только цифры,
    // начинается на 7 (даже если покупатель ввёл +7, 8, пробелы, скобки, дефисы)
    let cleanPhone = customer.phone.replace(/\D/g, '');
    if (cleanPhone.length === 11 && cleanPhone.startsWith('8')) {
      cleanPhone = '7' + cleanPhone.slice(1);
    }
    if (cleanPhone.length === 10) {
      cleanPhone = '7' + cleanPhone;
    }
    // Телефон нужен ЮKassa для электронного чека — проверяем, что он полный (11 цифр, начинается с 7)
    if (!/^7\d{10}$/.test(cleanPhone)) {
      return res.status(400).json({ error: 'Введите номер телефона полностью, например +7 900 123-45-67' });
    }
    customer.phone = cleanPhone;

    // ВАЖНО: цену пересчитываем на сервере по своему каталогу,
    // а не берём из браузера — иначе покупатель мог бы подделать сумму заказа.
    const products = await loadCatalog();
    let total = 0;
    const orderItems = [];

    for (const raw of items) {
      const item = raw && typeof raw === 'object' ? raw : {};
      const product = typeof item.id === 'string' ? products.find((p) => p.id === item.id && !p.stop) : null;
      if (!product) continue;

      if (product.type === 'variant') {
        // Товар с выбором варианта (например, хинкал с разным мясом)
        const variant = (product.variants || []).find((v) => v.id === item.variantId);
        if (!variant) continue;
        const qty = toInt(item.qty, 1, 50);
        if (qty === null) return res.status(400).json({ error: 'Неверное количество' });
        total += variant.price * qty;
        orderItems.push({
          id: product.id,
          name: `${product.name} (${variant.label})`,
          price: variant.price,
          qty,
        });
      } else if (product.type === 'combo') {
        // Набор с самостоятельной сборкой (например, набор чуду) — цена фиксированная.
        // Проверяем состав по нашему каталогу: только существующие позиции, не больше мест в наборе и лимита мясных.
        const selections = Array.isArray(item.comboSelections) ? item.comboSelections : [];
        let count = 0, meat = 0;
        const parts = [];
        for (const sel of selections.slice(0, 20)) {
          const opt = (product.options || []).find((o) => sel && o.name === sel.name);
          const c = toInt(sel && sel.count, 1, product.totalSlots);
          if (!opt || c === null) return res.status(400).json({ error: 'Неверный состав набора' });
          count += c;
          if (opt.isMeat) meat += c;
          parts.push(`${opt.name} ×${c}`);
        }
        if (count !== product.totalSlots || meat > product.meatMax) {
          return res.status(400).json({ error: 'Соберите набор полностью: неверный состав' });
        }
        total += product.price;
        orderItems.push({
          id: product.id,
          name: `${product.name}: ${parts.join(', ')}`,
          price: product.price,
          qty: 1,
        });
      } else {
        // Обычный товар без вариантов
        if (typeof product.price !== 'number') continue; // товары без цены заказать нельзя
        const qty = toInt(item.qty, 1, 50);
        if (qty === null) return res.status(400).json({ error: 'Неверное количество' });
        total += product.price * qty;
        orderItems.push({ id: product.id, name: product.name, price: product.price, qty });
      }
    }

    if (total <= 0) {
      return res.status(400).json({ error: 'Не удалось рассчитать сумму заказа' });
    }

    // Минимальный заказ и доставка считаются здесь, на сервере — подменить их на сайте нельзя
    const subtotal = total;
    if (subtotal < MIN_ORDER) {
      return res.status(400).json({ error: `Минимальный заказ — ${MIN_ORDER} ₽. Добавьте товары ещё на ${MIN_ORDER - subtotal} ₽` });
    }
    const deliveryFee = deliveryFeeFor(deliveryZone, subtotal);
    total = subtotal + deliveryFee;

    const orderId = uuidv4();
    const order = {
      id: orderId,
      items: orderItems,
      subtotal,
      deliveryFee,
      deliveryZone,
      geo,
      total,
      customer,
      cutleryCount,
      status: 'ожидает оплаты',
      paymentId: null,
      createdAt: new Date().toISOString(),
    };
    order.consentPdAt = order.createdAt; // когда дано согласие на обработку ПДн

    // --- Создаём платёж в ЮKassa ---
    const paymentResponse = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotence-Key': orderId,
        Authorization: yookassaAuth(),
      },
      body: JSON.stringify({
        amount: { value: total.toFixed(2), currency: 'RUB' },
        capture: true,
        confirmation: {
          type: 'redirect',
          return_url: `${SITE_URL}/order-success.html?orderId=${orderId}`,
        },
        description: 'Заказ на сайте «Дачная Беседка»',
        metadata: { orderId },
        receipt: {
          customer: { phone: customer.phone },
          items: orderItems.map((it) => ({
            description: it.name.slice(0, 128),
            quantity: it.qty.toFixed(2),
            amount: { value: it.price.toFixed(2), currency: 'RUB' },
            vat_code: 1,
            payment_subject: 'commodity',
            payment_mode: 'full_payment',
          })).concat(deliveryFee > 0 ? [{
            description: 'Доставка',
            quantity: '1.00',
            amount: { value: deliveryFee.toFixed(2), currency: 'RUB' },
            vat_code: 1,
            payment_subject: 'service',
            payment_mode: 'full_payment',
          }] : []),
        },
      }),
    });

    const payment = await paymentResponse.json();

    if (!paymentResponse.ok) {
      // В журнал — только код и описание ошибки (без данных покупателя), покупателю — общее сообщение
      console.error('Ошибка ЮKassa:', paymentResponse.status, payment && payment.code, payment && payment.description);
      return res.status(502).json({ error: 'Не удалось создать платёж. Попробуйте ещё раз чуть позже.' });
    }

    order.paymentId = payment.id;

    await db.addOrder(order);

    res.json({
      orderId,
      confirmationUrl: payment.confirmation.confirmation_url,
    });
  } catch (err) {
    console.error('Ошибка при создании заказа:', err.message);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// --- Проверка статуса заказа (например, для страницы "Спасибо за заказ") ---
app.get('/api/orders/:id', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Заказ не найден' });
    const order = await db.getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    res.json({
      id: order.id,
      number: order.number || null,
      status: order.status,
      total: order.total,
      createdAt: order.createdAt,
      prepMinutes: order.prepMinutes || null,
      readyEta: order.readyEta || null,
      courierEta: order.courierEta || null,
      paidAt: order.paidAt || null,
      acceptedAt: order.acceptedAt || null,
      readyAt: order.readyAt || null,
      handedToCourierAt: order.handedToCourierAt || null,
      deliveredAt: order.deliveredAt || null,
      deliveryMinutes: order.deliveryMinutes || null,
    });
  } catch (err) {
    console.error('Ошибка чтения заказа:', err.message);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// --- Список всех заказов для админ-страницы (защищено паролем) ---
app.get('/api/admin/orders', adminAuth, async (req, res) => {
  try {
    // Сначала новые заказы
    res.json(await db.listOrders());
  } catch (err) {
    console.error('Ошибка чтения заказов:', err.message);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// --- Меню для админ-страницы: стоп-лист и КБЖУ ---
app.get('/api/admin/products', adminAuth, async (req, res) => {
  try {
    const catalog = await loadCatalog();
    const fileProducts = readJSON(PRODUCTS_FILE); // исходные цены из products.json
    const per = (n) => (n && n.per100 ? { kcal: n.per100.kcal, protein: n.per100.protein, fat: n.per100.fat, carbs: n.per100.carbs } : null);
    res.json(catalog.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category || 'Меню',
      price: p.price,
      stop: !!p.stop,
      // цена из файла products.json (чтобы можно было вернуть) и цены вариантов
      basePrice: (fileProducts.find((x) => x.id === p.id) || {}).price,
      variantPrices: Array.isArray(p.variants) ? p.variants.map((v) => ({ id: v.id, label: v.label, price: v.price, basePrice: (((fileProducts.find((x) => x.id === p.id) || {}).variants || []).find((x) => x.id === v.id) || {}).price })) : [],
      per100: Array.isArray(p.variants) && p.variants.length ? null : per(p.nutrition),
      variants: Array.isArray(p.variants) ? p.variants.map((v) => ({ id: v.id, label: v.label, per100: per(v.nutrition) })) : [],
    })));
  } catch (err) {
    console.error('Ошибка чтения меню:', err.message);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// --- Стоп-лист: включить/выключить блюдо ---
app.post('/api/admin/products/:id/stop', adminAuth, async (req, res) => {
  try {
    const exists = readJSON(PRODUCTS_FILE).some((p) => p.id === req.params.id);
    if (!exists) return res.status(404).json({ error: 'Такого блюда нет' });
    await db.setProductStop(req.params.id, !!(req.body && req.body.stop));
    res.json({ ok: true, id: req.params.id, stop: !!(req.body && req.body.stop) });
  } catch (err) {
    console.error('Ошибка стоп-листа:', err.message);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// --- Цена: изменить цену блюда (или одного из его вариантов). price: пустое/null — вернуть цену из файла ---
app.post('/api/admin/products/:id/price', adminAuth, async (req, res) => {
  try {
    const product = readJSON(PRODUCTS_FILE).find((p) => p.id === req.params.id);
    if (!product) return res.status(404).json({ error: 'Такого блюда нет' });
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    let variantId = '';
    if (Array.isArray(product.variants) && product.variants.length) {
      variantId = typeof b.variantId === 'string' ? b.variantId : '';
      if (!product.variants.some((v) => v.id === variantId)) return res.status(400).json({ error: 'Не выбран вариант блюда' });
    }
    let price = null;
    if (!(b.price === null || b.price === '' || b.price === undefined)) {
      const n = Number(b.price);
      if (!Number.isInteger(n) || n < 1 || n > 100000) {
        return res.status(400).json({ error: 'Цена — целое число рублей от 1 до 100000' });
      }
      price = n;
    }
    await db.setPrice(product.id, variantId, price);
    console.log(`Цена изменена в админке: ${product.id}${variantId ? '/' + variantId : ''} → ${price === null ? 'как в файле' : price + ' ₽'}`);
    res.json({ ok: true, price });
  } catch (err) {
    console.error('Ошибка сохранения цены:', err.message);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// --- КБЖУ: изменить значения на 100 г (на порцию пересчитывается само по весу) ---
app.post('/api/admin/products/:id/nutrition', adminAuth, async (req, res) => {
  try {
    const product = readJSON(PRODUCTS_FILE).find((p) => p.id === req.params.id);
    if (!product) return res.status(404).json({ error: 'Такого блюда нет' });
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    let variantId = '';
    if (Array.isArray(product.variants) && product.variants.length) {
      variantId = typeof b.variantId === 'string' ? b.variantId : '';
      if (!product.variants.some((v) => v.id === variantId)) return res.status(400).json({ error: 'Не выбран вариант блюда' });
    }
    const num = (v, max) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 10) / 10 : null; };
    const per100 = { kcal: num(b.kcal, 2000), protein: num(b.protein, 200), fat: num(b.fat, 200), carbs: num(b.carbs, 200) };
    if (Object.values(per100).some((v) => v === null)) {
      return res.status(400).json({ error: 'Введите числа: калории до 2000, белки/жиры/углеводы до 200 на 100 г' });
    }
    await db.setNutrition(product.id, variantId, per100);
    res.json({ ok: true });
  } catch (err) {
    console.error('Ошибка сохранения КБЖУ:', err.message);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// --- Смена статуса заказа из админ-страницы (кафе) ---
// Цепочка: оплачен → принят (готовится) → готов → передан курьеру → доставлен
const STATUS_FLOW = {
  'оплачен': ['принят'],
  'принят': ['готов'],
  'готов': ['передан курьеру'],
  'передан курьеру': ['доставлен'],
};
app.post('/api/admin/orders/:id/status', adminAuth, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Заказ не найден' });
    const next = req.body && req.body.status;
    const order = await db.getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    if (!(STATUS_FLOW[order.status] || []).includes(next)) {
      return res.status(400).json({ error: `Нельзя перевести заказ из «${order.status}» в «${String(next).slice(0, 30)}»` });
    }
    const patch = { status: next };
    const now = new Date();
    if (next === 'принят') {
      const mins = Math.min(180, Math.max(5, parseInt(req.body.prepMinutes, 10) || 30));
      patch.prepMinutes = mins;
      patch.acceptedAt = now.toISOString();
      patch.readyEta = new Date(now.getTime() + mins * 60000).toISOString();
      // Курьера нужно вызвать заранее: за «время подачи» (COURIER_LEAD_MIN) до готовности блюда.
      // Готовим 10 мин, подача 15 — вызываем сразу; готовим 40 — вызываем через 25 минут.
      if (yd.enabled() && order.geo) {
        const delayMin = Math.max(0, mins - courierLeadMin());
        patch.courierCallAt = new Date(now.getTime() + delayMin * 60000).toISOString();
        patch.courierCallDone = false;
      }
    }
    if (next === 'готов') patch.readyAt = now.toISOString();
    if (next === 'передан курьеру') {
      const dm = Math.min(120, Math.max(5, parseInt(req.body.deliveryMinutes, 10) || 20));
      patch.deliveryMinutes = dm;
      patch.handedToCourierAt = now.toISOString();
      patch.courierEta = new Date(now.getTime() + dm * 60000).toISOString();
    }
    if (next === 'доставлен') patch.deliveredAt = now.toISOString();
    const updated = await db.updateOrder(order.id, patch);
    // Автоматический вызов курьера: если время вызова уже пришло (короткая готовка) — вызываем сразу,
    // иначе его вызовет таймер (pollCouriers). Если заказ готов, а курьер так и не вызван — вызываем сейчас.
    if (yd.enabled() && yd.autoMode() && updated) {
      if (next === 'принят') runScheduledCourier(updated).catch((e) => console.error('Авто-вызов курьера:', e.message));
      if (next === 'готов' && !courierIsLive(updated.courier)) {
        callCourierNow(updated).catch((e) => console.error('Авто-вызов курьера:', e.message));
      }
    }
    res.json(updated);
  } catch (err) {
    console.error('Ошибка смены статуса:', err.message);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// ==========================================================================
// КУРЬЕР ЯНДЕКС ДОСТАВКИ (работает только если задан YANDEX_DELIVERY_TOKEN, см. yandex-delivery.js)
// ==========================================================================
const courierBusy = new Set(); // заказы, по которым прямо сейчас идёт запрос к Яндексу (защита от двойного нажатия)

function courierError(res, err) {
  console.error('Яндекс Доставка:', err.status || '', err.apiCode || '', err.apiMessage || err.message);
  const text = err.apiMessage ? `Яндекс Доставка отказала: ${String(err.apiMessage).slice(0, 200)}` : 'Яндекс Доставка не ответила. Попробуйте ещё раз через минуту.';
  res.status(502).json({ error: text });
}

async function loadCourierOrder(req, res) {
  if (!yd.enabled()) { res.status(400).json({ error: 'Курьер Яндекса не подключён' }); return null; }
  if (!UUID_RE.test(req.params.id)) { res.status(404).json({ error: 'Заказ не найден' }); return null; }
  const order = await db.getOrder(req.params.id);
  if (!order) { res.status(404).json({ error: 'Заказ не найден' }); return null; }
  return order;
}

async function autoCourier(order) {
  if (!order.geo || courierBusy.has(order.id)) return;
  courierBusy.add(order.id);
  try {
    let courier = await yd.estimate(order, KITCHEN_COORDS);
    await db.updateOrder(order.id, { courier });
    if (courier.status === 'ready_for_approval') {
      const done = await yd.confirm(courier);
      if (done) await db.updateOrder(order.id, { courier: done });
    }
  } finally {
    courierBusy.delete(order.id);
  }
}

// За сколько минут до готовности вызывать курьера (сколько он обычно едет к лавке). Меняется в Timeweb: COURIER_LEAD_MIN
function courierLeadMin() {
  const n = Number(process.env.COURIER_LEAD_MIN);
  return Number.isFinite(n) && n >= 0 && n <= 120 ? n : 15;
}

// есть ли по заказу «живая» заявка курьера (тогда второго не вызываем)
function courierIsLive(c) {
  if (!c || !c.claimId || !yd.LIVE.has(c.status)) return false;
  if (c.status === 'ready_for_approval' && Date.now() - new Date(c.createdAt).getTime() > yd.OFFER_TTL_MS) return false;
  return true;
}

// Вызов курьера с записью ошибки в заказ (чтобы повар увидел, что не получилось, и нажал кнопку вручную)
async function callCourierNow(order) {
  try {
    await autoCourier(order);
  } catch (e) {
    console.error('Яндекс Доставка (авто):', e.status || '', e.apiMessage || e.message);
    const msg = e.apiMessage ? String(e.apiMessage).slice(0, 200) : 'Яндекс Доставка не ответила';
    await db.updateOrder(order.id, { courier: { status: 'failed', error: msg + '. Вызовите курьера кнопкой.' } });
  }
}

// Если у принятого заказа пришло время вызова курьера — вызываем (один раз)
async function runScheduledCourier(order) {
  if (!yd.enabled() || !yd.autoMode()) return;
  if (order.status !== 'принят' || !order.courierCallAt || order.courierCallDone) return;
  if (new Date(order.courierCallAt).getTime() > Date.now()) return;
  if (courierIsLive(order.courier) || courierBusy.has(order.id)) return;
  const claimed = await db.updateOrder(order.id, { courierCallDone: true }); // отметили заранее, чтобы не вызвать дважды
  if (claimed) await callCourierNow({ ...order, ...claimed });
}

app.get('/api/admin/courier-config', adminAuth, (req, res) => {
  res.json({ enabled: yd.enabled(), auto: yd.autoMode(), leadMin: courierLeadMin(), statusText: yd.STATUS_TEXT });
});

// Узнать цену курьера (создаёт заявку в Яндексе, но курьера пока не вызывает)
app.post('/api/admin/orders/:id/courier/estimate', adminAuth, async (req, res) => {
  const order = await loadCourierOrder(req, res); if (!order) return;
  if (!['принят', 'готов'].includes(order.status)) return res.status(400).json({ error: 'Курьера можно вызвать, когда заказ принят или готов' });
  if (!order.geo) return res.status(400).json({ error: 'У этого заказа нет точки на карте — вызовите курьера вручную' });
  const c = order.courier;
  if (c && yd.LIVE.has(c.status) && !(c.status === 'ready_for_approval' && Date.now() - new Date(c.createdAt).getTime() > yd.OFFER_TTL_MS)) {
    return res.json(c); // уже есть живая заявка — второго курьера не заказываем
  }
  if (courierBusy.has(order.id)) return res.status(409).json({ error: 'Запрос уже выполняется, подождите несколько секунд' });
  courierBusy.add(order.id);
  try {
    const courier = await yd.estimate(order, KITCHEN_COORDS);
    await db.updateOrder(order.id, { courier });
    res.json(courier);
  } catch (err) {
    courierError(res, err);
  } finally {
    courierBusy.delete(order.id);
  }
});

// Вызвать курьера: подтвердить заявку по названной цене
app.post('/api/admin/orders/:id/courier/accept', adminAuth, async (req, res) => {
  const order = await loadCourierOrder(req, res); if (!order) return;
  const c = order.courier;
  if (!c || !c.claimId) return res.status(400).json({ error: 'Сначала узнайте цену курьера' });
  if (courierBusy.has(order.id)) return res.status(409).json({ error: 'Запрос уже выполняется, подождите несколько секунд' });
  courierBusy.add(order.id);
  try {
    const done = await yd.confirm(c);
    if (done === null) {
      await db.updateOrder(order.id, { courier: { ...c, status: 'failed', error: 'Цена устарела — узнайте её заново' } });
      return res.status(409).json({ error: 'Цена устарела (прошло больше 9 минут). Нажмите «Узнать цену» ещё раз.' });
    }
    await db.updateOrder(order.id, { courier: done });
    res.json(done);
  } catch (err) {
    courierError(res, err);
  } finally {
    courierBusy.delete(order.id);
  }
});

// Раз в 20 секунд спрашиваем Яндекс, что с курьерами; забрал — «передан курьеру», доставил — «доставлен»
async function pollCouriers() {
  if (!yd.enabled()) return;
  let list;
  try { list = await db.listOrders(); } catch (e) { return; }
  for (const o of list) {
    try { await runScheduledCourier(o); } catch (e) { console.error('Плановый вызов курьера:', e.message); }
  }
  try { list = await db.listOrders(); } catch (e) { return; }
  for (const o of list) {
    const c = o.courier;
    if (!c || !c.claimId || yd.TERMINAL.has(c.status) || courierBusy.has(o.id)) continue;
    try {
      const fresh = await yd.getInfo(c.claimId, c);
      const patch = {};
      if (fresh.status !== c.status || fresh.price !== c.price || fresh.eta !== c.eta || JSON.stringify(fresh.performer) !== JSON.stringify(c.performer)) patch.courier = fresh;
      const now = new Date();
      if (['pickuped', 'delivery_arrived', 'ready_for_delivery_confirmation'].includes(fresh.status) && ['принят', 'готов'].includes(o.status)) {
        const dm = Math.min(120, Math.max(5, fresh.eta || 20));
        Object.assign(patch, { status: 'передан курьеру', deliveryMinutes: dm, handedToCourierAt: now.toISOString(), courierEta: new Date(now.getTime() + dm * 60000).toISOString() });
      }
      if (['delivered', 'delivered_finish'].includes(fresh.status) && ['принят', 'готов', 'передан курьеру'].includes(o.status)) {
        Object.assign(patch, { status: 'доставлен', deliveredAt: now.toISOString() });
      }
      if (Object.keys(patch).length) await db.updateOrder(o.id, patch);
    } catch (e) {
      console.error('Опрос Яндекс Доставки:', e.status || '', e.apiMessage || e.message);
    }
  }
}

// --- Вебхук от ЮKassa: сюда ЮKassa сама присылает уведомления об оплате ---
// Статус платежа мы НЕ берём из присланного сообщения (его мог подделать кто угодно),
// а сами спрашиваем у ЮKassa, что на самом деле с этим платежом, и сверяем сумму и номер платежа с заказом.
app.post('/api/yookassa-webhook', async (req, res) => {
  try {
    const paymentId = req.body && req.body.object && req.body.object.id;
    if (typeof paymentId === 'string' && /^[\w-]{10,64}$/.test(paymentId)) {
      const r = await fetch(`https://api.yookassa.ru/v3/payments/${encodeURIComponent(paymentId)}`, {
        headers: { Authorization: yookassaAuth() },
      });
      if (r.ok) {
        const payment = await r.json();
        const orderId = payment && payment.metadata && payment.metadata.orderId;
        if (typeof orderId === 'string' && UUID_RE.test(orderId)) {
          const before = await db.getOrder(orderId);
          const sameOrder = before && before.paymentId === payment.id;
          if (payment.status === 'succeeded' && payment.paid) {
            // ЮKassa может прислать одно уведомление несколько раз — сообщаем о заказе только один раз
            const amountOk = payment.amount && payment.amount.currency === 'RUB' && Number(payment.amount.value) === Number(before && before.total);
            if (sameOrder && amountOk && before.status === 'ожидает оплаты') {
              const number = await db.nextOrderNumber(); // красивый номер заказа выдаётся при оплате
              const paid = await db.updateOrder(orderId, { status: 'оплачен', paidAt: new Date().toISOString(), number });
              if (paid) await notifyPaidOrder(paid);
            } else if (before && !(sameOrder && amountOk)) {
              console.error('Вебхук: платёж не совпал с заказом', orderId);
            }
          } else if (payment.status === 'canceled') {
            if (sameOrder && before.status === 'ожидает оплаты') await db.setStatus(orderId, 'отменён');
          }
        }
      } else {
        console.error('Не удалось проверить платёж в ЮKassa:', r.status);
        // Отвечаем ошибкой — ЮKassa повторит уведомление позже
        return res.sendStatus(500);
      }
    }
    // ЮKassa ждёт ответ 200 OK, иначе будет повторять уведомление
    res.sendStatus(200);
  } catch (err) {
    console.error('Ошибка вебхука:', err.message);
    res.sendStatus(500);
  }
});

// --- Любые ошибки (например, битый JSON в запросе) — коротким ответом, без внутренних деталей ---
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Неверный формат запроса' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Запрос слишком большой' });
  console.error('Ошибка сервера:', err && err.message);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

const PORT = process.env.PORT || 3000;
db.init().then(() => {
  checkEnv();
  app.listen(PORT, () => {
    console.log(`Сайт запущен: http://localhost:${PORT}`);
  });
  if (yd.enabled()) {
    console.log('Курьер Яндекс Доставки подключён' + (yd.autoMode() ? ' (автоматический вызов)' : ' (вызов кнопкой)'));
    setInterval(() => { pollCouriers().catch(() => {}); }, Number(process.env.YANDEX_POLL_MS) || 20000).unref();
  }
});
