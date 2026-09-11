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

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PRODUCTS_FILE = path.join(__dirname, 'products.json');
const ORDERS_FILE = '/tmp/orders.json';

const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;
const SITE_URL = process.env.SITE_URL || 'http://localhost:3000';

// Создаём файл заказов, если его ещё нет
if (!fs.existsSync(ORDERS_FILE)) {
  fs.writeFileSync(ORDERS_FILE, '[]', 'utf-8');
}

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}
function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// --- Отдаём каталог товаров ---
app.get('/api/products', (req, res) => {
  const products = readJSON(PRODUCTS_FILE);
  res.json(products);
});

// --- Приём нового заказа ---
app.post('/api/orders', async (req, res) => {
  try {
    const { items, customer } = req.body;

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
    customer.phone = cleanPhone;

    // ВАЖНО: цену пересчитываем на сервере по своему каталогу,
    // а не берём из браузера — иначе покупатель мог бы подделать сумму заказа.
    const products = readJSON(PRODUCTS_FILE);
    let total = 0;
    const orderItems = [];

    for (const item of items) {
      const product = products.find((p) => p.id === item.id);
      if (!product) continue;
      const qty = Math.max(1, parseInt(item.qty, 10) || 1);
      total += product.price * qty;
      orderItems.push({ id: product.id, name: product.name, price: product.price, qty });
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
        Authorization:
          'Basic ' + Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString('base64'),
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

    const orders = readJSON(ORDERS_FILE);
    orders.push(order);
    writeJSON(ORDERS_FILE, orders);

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
app.get('/api/orders/:id', (req, res) => {
  const orders = readJSON(ORDERS_FILE);
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });
  res.json({ id: order.id, status: order.status, total: order.total });
});

// --- Список всех заказов для админ-страницы (защищено паролем) ---
app.get('/api/admin/orders', (req, res) => {
  const key = req.query.key;
  if (!key || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Неверный пароль' });
  }
  const orders = readJSON(ORDERS_FILE);
  // Показываем сначала новые заказы
  res.json(orders.slice().reverse());
});

// --- Вебхук от ЮKassa: сюда ЮKassa сама присылает уведомления об оплате ---
app.post('/api/yookassa-webhook', (req, res) => {
  try {
    const event = req.body;
    const orderId = event?.object?.metadata?.orderId;

    if (orderId) {
      const orders = readJSON(ORDERS_FILE);
      const order = orders.find((o) => o.id === orderId);
      if (order) {
        if (event.event === 'payment.succeeded') {
          order.status = 'оплачен';
        } else if (event.event === 'payment.canceled') {
          order.status = 'отменён';
        }
        writeJSON(ORDERS_FILE, orders);
      }
    }
    // ЮKassa ждёт ответ 200 OK, иначе будет повторять уведомление
    res.sendStatus(200);
  } catch (err) {
    console.error('Ошибка вебхука:', err);
    res.sendStatus(200); // всё равно отвечаем 200, чтобы ЮKassa не спамила повторами
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сайт запущен: http://localhost:${PORT}`);
});
