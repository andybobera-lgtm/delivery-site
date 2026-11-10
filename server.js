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
const FREE_DELIVERY_FROM = Number(process.env.FREE_DELIVERY_FROM) || 3000; // от этой суммы доставка бесплатная, ₽

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
  res.json({ minOrder: MIN_ORDER, deliveryFee: DELIVERY_FEE, freeDeliveryFrom: FREE_DELIVERY_FROM });
});

// --- Каталог с учётом стоп-листа и правок КБЖУ из админ-панели ---
// Стоп можно задать двумя способами: переключателем в админ-панели (хранится в базе)
// или строкой "stop": true в products.json. Переключатель в админке главнее.
function round1(v) { return Math.round(v * 10) / 10; }
function withPer100(nutrition, per100) {
  const w = (nutrition && nutrition.perPortion && nutrition.perPortion.weight) || 0;
  const k = w / 100;
  return {
    per100: { kcal: per100.kcal, protein: per100.protein, fat: per100.fat, carbs: per100.carbs },
    perPortion: { weight: w, kcal: round1(per100.kcal * k), protein: round1(per100.protein * k), fat: round1(per100.fat * k), carbs: round1(per100.carbs * k) },
  };
}
async function loadCatalog() {
  const products = readJSON(PRODUCTS_FILE);
  let stops = {}, nuts = {};
  try { stops = await db.getStopOverrides(); } catch (e) { console.error('Стоп-лист не прочитан:', e.message); }
  try { nuts = await db.getNutritionOverrides(); } catch (e) { console.error('КБЖУ не прочитано:', e.message); }
  return products.map((p) => {
    const q = { ...p, stop: Object.prototype.hasOwnProperty.call(stops, p.id) ? !!stops[p.id] : !!p.stop };
    if (nuts[p.id + '|'] && q.nutrition) q.nutrition = withPer100(q.nutrition, nuts[p.id + '|']);
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
    const deliveryFee = subtotal >= FREE_DELIVERY_FROM ? 0 : DELIVERY_FEE;
    total = subtotal + deliveryFee;

    const orderId = uuidv4();
    const order = {
      id: orderId,
      items: orderItems,
      subtotal,
      deliveryFee,
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
        description: `Заказ №${orderId.slice(0, 8)}`,
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
    const per = (n) => (n && n.per100 ? { kcal: n.per100.kcal, protein: n.per100.protein, fat: n.per100.fat, carbs: n.per100.carbs } : null);
    res.json(catalog.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category || 'Меню',
      price: p.price,
      stop: !!p.stop,
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
    }
    if (next === 'готов') patch.readyAt = now.toISOString();
    if (next === 'передан курьеру') {
      const dm = Math.min(120, Math.max(5, parseInt(req.body.deliveryMinutes, 10) || 20));
      patch.deliveryMinutes = dm;
      patch.handedToCourierAt = now.toISOString();
      patch.courierEta = new Date(now.getTime() + dm * 60000).toISOString();
    }
    if (next === 'доставлен') patch.deliveredAt = now.toISOString();
    res.json(await db.updateOrder(order.id, patch));
  } catch (err) {
    console.error('Ошибка смены статуса:', err.message);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

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
              const paid = await db.updateOrder(orderId, { status: 'оплачен', paidAt: new Date().toISOString() });
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
});
