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
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { notifyPaidOrder } = require('./notify');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/legal', express.static(path.join(__dirname, 'legal')));

const PRODUCTS_FILE = path.join(__dirname, 'products.json');

const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;
const SITE_URL = process.env.SITE_URL || 'http://localhost:3000';

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// Данные для входа в ЮKassa
function yookassaAuth() {
  return 'Basic ' + Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString('base64');
}

// --- Проверка: где хранятся заказы (откройте адрес-сайта/api/health) ---
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ordersStorage: db.getMode() });
});

// --- Отдаём каталог товаров ---
app.get('/api/products', (req, res) => {
  const products = readJSON(PRODUCTS_FILE);
  res.json(products);
});

// --- Приём нового заказа ---
app.post('/api/orders', async (req, res) => {
  try {
    const { items, customer, cutleryCount } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Корзина пуста' });
    }
    if (!customer || !customer.name || !customer.phone || !customer.address) {
      return res.status(400).json({ error: 'Не заполнены данные покупателя' });
    }

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
    const products = readJSON(PRODUCTS_FILE);
    let total = 0;
    const orderItems = [];

    for (const item of items) {
      const product = products.find((p) => p.id === item.id);
      if (!product) continue;

      if (product.type === 'variant') {
        // Товар с выбором варианта (например, хинкал с разным мясом)
        const variant = (product.variants || []).find((v) => v.id === item.variantId);
        if (!variant) continue;
        const qty = Math.max(1, parseInt(item.qty, 10) || 1);
        total += variant.price * qty;
        orderItems.push({
          id: product.id,
          name: `${product.name} (${variant.label})`,
          price: variant.price,
          qty,
        });
      } else if (product.type === 'combo') {
        // Набор с самостоятельной сборкой (например, набор чуду) — цена фиксированная,
        // состав нужен только для описания в заказе, на сумму не влияет
        const selections = Array.isArray(item.comboSelections) ? item.comboSelections : [];
        const compositionText = selections
          .filter((s) => s.count > 0)
          .map((s) => `${s.name} ×${s.count}`)
          .join(', ');
        total += product.price;
        orderItems.push({
          id: product.id,
          name: compositionText ? `${product.name}: ${compositionText}` : product.name,
          price: product.price,
          qty: 1,
        });
      } else {
        // Обычный товар без вариантов
        if (typeof product.price !== 'number') continue; // товары без цены заказать нельзя
        const qty = Math.max(1, parseInt(item.qty, 10) || 1);
        total += product.price * qty;
        orderItems.push({ id: product.id, name: product.name, price: product.price, qty });
      }
    }

    if (total <= 0) {
      return res.status(400).json({ error: 'Не удалось рассчитать сумму заказа' });
    }

    const orderId = uuidv4();
    const order = {
      id: orderId,
      items: orderItems,
      total,
      customer,
      cutleryCount: Number.isFinite(parseInt(cutleryCount, 10)) ? parseInt(cutleryCount, 10) : 0,
      status: 'ожидает оплаты',
      paymentId: null,
      createdAt: new Date().toISOString(),
    };

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
          })),
        },
      }),
    });

    const payment = await paymentResponse.json();

    if (!paymentResponse.ok) {
      console.error('Ошибка ЮKassa:', payment);
      return res.status(502).json({ error: 'Не удалось создать платёж', details: payment });
    }

    order.paymentId = payment.id;

    await db.addOrder(order);

    res.json({
      orderId,
      confirmationUrl: payment.confirmation.confirmation_url,
    });
  } catch (err) {
    console.error('Ошибка при создании заказа:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// --- Проверка статуса заказа (например, для страницы "Спасибо за заказ") ---
app.get('/api/orders/:id', async (req, res) => {
  try {
    const order = await db.getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    res.json({ id: order.id, status: order.status, total: order.total });
  } catch (err) {
    console.error('Ошибка чтения заказа:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// --- Список всех заказов для админ-страницы (защищено паролем) ---
app.get('/api/admin/orders', async (req, res) => {
  const key = req.query.key;
  if (!key || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Неверный пароль' });
  }
  try {
    // Сначала новые заказы
    res.json(await db.listOrders());
  } catch (err) {
    console.error('Ошибка чтения заказов:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// --- Вебхук от ЮKassa: сюда ЮKassa сама присылает уведомления об оплате ---
// Статус платежа мы НЕ берём из присланного сообщения (его мог подделать кто угодно),
// а сами спрашиваем у ЮKassa, что на самом деле с этим платежом.
app.post('/api/yookassa-webhook', async (req, res) => {
  try {
    const paymentId = req.body?.object?.id;
    if (paymentId) {
      const r = await fetch(`https://api.yookassa.ru/v3/payments/${encodeURIComponent(paymentId)}`, {
        headers: { Authorization: yookassaAuth() },
      });
      if (r.ok) {
        const payment = await r.json();
        const orderId = payment?.metadata?.orderId;
        if (orderId) {
          if (payment.status === 'succeeded') {
            // ЮKassa может прислать одно уведомление несколько раз — сообщаем о заказе только один раз
            const before = await db.getOrder(orderId);
            if (before && before.status !== 'оплачен') {
              const paid = await db.setStatus(orderId, 'оплачен');
              if (paid) await notifyPaidOrder(paid);
            }
          } else if (payment.status === 'canceled') {
            await db.setStatus(orderId, 'отменён');
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
    console.error('Ошибка вебхука:', err);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
db.init().then(() => {
  app.listen(PORT, () => {
    console.log(`Сайт запущен: http://localhost:${PORT}`);
  });
});
