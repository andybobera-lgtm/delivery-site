// ==========================================================================
// ХРАНИЛИЩЕ ЗАКАЗОВ
// Если задана переменная DATABASE_URL — заказы хранятся в базе PostgreSQL
// (не пропадают при перезапусках и обновлениях сайта).
// Если не задана — заказы временно пишутся в файл (пропадут при перезапуске!).
// ==========================================================================

const fs = require('fs');

const FILE_PATH = process.env.ORDERS_FILE || '/tmp/orders.json';

let pool = null;
let mode = 'file'; // 'postgres' или 'file'

// ---------- Файловое хранилище (запасной вариант) ----------
function fileRead() {
  if (!fs.existsSync(FILE_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(FILE_PATH, 'utf-8'));
  } catch (e) {
    return [];
  }
}
function fileWrite(data) {
  fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------- Запуск: подключаемся к базе, если она указана ----------
async function init() {
  if (!process.env.DATABASE_URL) {
    console.warn(
      '⚠ DATABASE_URL не задан: заказы хранятся во временном файле и пропадут при перезапуске сайта!'
    );
    return mode;
  }
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
      max: 5,
      connectionTimeoutMillis: 8000,
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id         TEXT PRIMARY KEY,
        data       JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    mode = 'postgres';
    console.log('✔ Заказы хранятся в базе данных PostgreSQL');
  } catch (err) {
    console.error('✖ Не удалось подключиться к базе данных:', err.message);
    console.warn('⚠ Включён временный режим: заказы пишутся в файл и пропадут при перезапуске!');
    pool = null;
    mode = 'file';
  }
  return mode;
}

function getMode() {
  return mode;
}

async function addOrder(order) {
  if (mode === 'postgres') {
    await pool.query('INSERT INTO orders (id, data) VALUES ($1, $2)', [order.id, order]);
    return;
  }
  const orders = fileRead();
  orders.push(order);
  fileWrite(orders);
}

async function getOrder(id) {
  if (mode === 'postgres') {
    const r = await pool.query('SELECT data FROM orders WHERE id = $1', [id]);
    return r.rows[0] ? r.rows[0].data : null;
  }
  return fileRead().find((o) => o.id === id) || null;
}

// Все заказы, сначала новые
async function listOrders() {
  if (mode === 'postgres') {
    const r = await pool.query('SELECT data FROM orders ORDER BY created_at DESC');
    return r.rows.map((row) => row.data);
  }
  return fileRead().slice().reverse();
}

// Обновляет поля заказа (patch — объект с новыми значениями) и возвращает заказ (или null)
async function updateOrder(id, patch) {
  if (mode === 'postgres') {
    const r = await pool.query(
      `UPDATE orders SET data = data || $2::jsonb WHERE id = $1 RETURNING data`,
      [id, JSON.stringify(patch)]
    );
    return r.rows[0] ? r.rows[0].data : null;
  }
  const orders = fileRead();
  const order = orders.find((o) => o.id === id);
  if (!order) return null;
  Object.assign(order, patch);
  fileWrite(orders);
  return order;
}

// Меняет статус заказа и возвращает обновлённый заказ (или null, если такого нет)
function setStatus(id, status) {
  return updateOrder(id, { status });
}

module.exports = { init, getMode, addOrder, getOrder, listOrders, setStatus, updateOrder };
