// ==========================================================================
// ХРАНИЛИЩЕ ЗАКАЗОВ
// Если задана переменная DATABASE_URL — заказы хранятся в базе PostgreSQL
// (не пропадают при перезапусках и обновлениях сайта).
// Если не задана — заказы временно пишутся в файл (пропадут при перезапуске!).
// ==========================================================================

const fs = require('fs');

const FILE_PATH = process.env.ORDERS_FILE || '/tmp/orders.json';
const STOP_FILE_PATH = process.env.STOPLIST_FILE || '/tmp/stoplist.json';
const NUTRITION_FILE_PATH = process.env.NUTRITION_FILE || '/tmp/nutrition.json';
const PRICE_FILE_PATH = process.env.PRICES_FILE || '/tmp/prices.json';
const EDITS_FILE_PATH = process.env.EDITS_FILE || '/tmp/product_edits.json';
const CHAT_FILE_PATH = process.env.CHAT_FILE || '/tmp/chat.json';

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
async function connectOnce() {
  {
    try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
      max: 5,
      connectionTimeoutMillis: 8000,
    });
    // если база перезапустится позже — не падаем, запросы просто получат ошибку и повторятся
    pool.on('error', (e) => console.error('Ошибка соединения с базой:', e.message));
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id         TEXT PRIMARY KEY,
        data       JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_stop (
        id   TEXT PRIMARY KEY,
        stop BOOLEAN NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_nutrition (
        id      TEXT NOT NULL,
        variant TEXT NOT NULL DEFAULT '',
        per100  JSONB NOT NULL,
        PRIMARY KEY (id, variant)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_price (
        id      TEXT NOT NULL,
        variant TEXT NOT NULL DEFAULT '',
        price   INTEGER NOT NULL,
        PRIMARY KEY (id, variant)
      )
    `);
    // Правки описания и веса блюд из админ-панели
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_edit (
        id   TEXT PRIMARY KEY,
        data JSONB NOT NULL
      )
    `);
    // Чат с оператором: одно сообщение — одна строка, переписка = общий thread
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_message (
        id         BIGSERIAL PRIMARY KEY,
        thread     TEXT NOT NULL,
        sender     TEXT NOT NULL,
        text       TEXT NOT NULL,
        name       TEXT NOT NULL DEFAULT '',
        read       BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS chat_message_thread_idx ON chat_message (thread, id)');
    await pool.query('CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1001');
    mode = 'postgres';
    console.log('✔ Заказы хранятся в базе данных PostgreSQL');
    } catch (err) {
      try { if (pool) await pool.end(); } catch (e) {}
      pool = null;
      throw err;
    }
  }
}

// Перенос заказов, принятых во временном режиме, в базу (после переподключения)
async function migrateFileOrders() {
  const rows = fileRead();
  for (const o of rows) {
    try { await pool.query('INSERT INTO orders (id, data) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [o.id, o]); } catch (e) {}
  }
  if (rows.length) console.log('✔ Перенесено заказов из временного файла в базу:', rows.length);
}

let reconnecting = false;
function reconnectLoop() {
  if (reconnecting) return;
  reconnecting = true;
  const tick = async () => {
    try {
      await connectOnce();
      await migrateFileOrders();
      reconnecting = false;
    } catch (err) {
      console.error('✖ База пока недоступна, пробуем снова через 30 с:', err.message);
      setTimeout(tick, 30000).unref();
    }
  };
  setTimeout(tick, 30000).unref();
}

async function init() {
  if (!process.env.DATABASE_URL) {
    console.warn('⚠ DATABASE_URL не задан: заказы хранятся во временном файле и пропадут при перезапуске сайта!');
    return mode;
  }
  // База может перезапускаться (обслуживание хостинга) — пробуем несколько раз, а не сдаёмся сразу
  for (let i = 1; i <= 6; i++) {
    try { await connectOnce(); return mode; }
    catch (err) {
      console.error(`✖ Не удалось подключиться к базе данных (попытка ${i}/6):`, err.message);
      if (i < 6) await new Promise((r) => setTimeout(r, 5000));
    }
  }
  console.warn('⚠ Включён временный режим: заказы пишутся в файл. Сайт продолжит пробовать подключиться к базе сам.');
  mode = 'file';
  reconnectLoop();
  return mode;
}



function getMode() {
  return mode;
}

// Красивый порядковый номер заказа: 1001, 1002, 1003… Выдаётся при оплате, поэтому без «дыр».
async function nextOrderNumber() {
  if (mode === 'postgres') {
    const r = await pool.query("SELECT nextval('order_number_seq') AS n");
    return Number(r.rows[0].n);
  }
  const nums = fileRead().map((o) => Number(o.number) || 0);
  return Math.max(1000, ...nums) + 1;
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

// ---------- Стоп-лист блюд ----------
// Возвращает объект { id блюда: true/false } — то, что повар выставил в админ-панели.
async function getStopOverrides() {
  if (mode === 'postgres') {
    const r = await pool.query('SELECT id, stop FROM product_stop');
    const out = {};
    r.rows.forEach((row) => { out[row.id] = row.stop; });
    return out;
  }
  try {
    return JSON.parse(fs.readFileSync(STOP_FILE_PATH, 'utf-8'));
  } catch (e) {
    return {};
  }
}

async function setProductStop(id, stop) {
  if (mode === 'postgres') {
    await pool.query(
      `INSERT INTO product_stop (id, stop) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET stop = EXCLUDED.stop`,
      [id, !!stop]
    );
    return;
  }
  const data = await getStopOverrides();
  data[id] = !!stop;
  fs.writeFileSync(STOP_FILE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------- КБЖУ, исправленное в админ-панели ----------
// Возвращает объект { "id блюда|id варианта": { kcal, protein, fat, carbs } } (на 100 г)
async function getNutritionOverrides() {
  if (mode === 'postgres') {
    const r = await pool.query('SELECT id, variant, per100 FROM product_nutrition');
    const out = {};
    r.rows.forEach((row) => { out[row.id + '|' + row.variant] = row.per100; });
    return out;
  }
  try {
    return JSON.parse(fs.readFileSync(NUTRITION_FILE_PATH, 'utf-8'));
  } catch (e) {
    return {};
  }
}

async function setNutrition(id, variant, per100) {
  if (mode === 'postgres') {
    await pool.query(
      `INSERT INTO product_nutrition (id, variant, per100) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (id, variant) DO UPDATE SET per100 = EXCLUDED.per100`,
      [id, variant || '', JSON.stringify(per100)]
    );
    return;
  }
  const data = await getNutritionOverrides();
  data[id + '|' + (variant || '')] = per100;
  fs.writeFileSync(NUTRITION_FILE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------- Цены, изменённые в админ-панели ----------
// Возвращает объект { "id блюда|id варианта": цена в рублях }. Если для блюда цены тут нет — берётся цена из products.json.
async function getPriceOverrides() {
  if (mode === 'postgres') {
    const r = await pool.query('SELECT id, variant, price FROM product_price');
    const out = {};
    r.rows.forEach((row) => { out[row.id + '|' + row.variant] = row.price; });
    return out;
  }
  try {
    return JSON.parse(fs.readFileSync(PRICE_FILE_PATH, 'utf-8'));
  } catch (e) {
    return {};
  }
}

// price = число (рубли) — задать новую цену; price = null — убрать правку и вернуть цену из products.json
async function setPrice(id, variant, price) {
  const v = variant || '';
  if (mode === 'postgres') {
    if (price === null) {
      await pool.query('DELETE FROM product_price WHERE id = $1 AND variant = $2', [id, v]);
    } else {
      await pool.query(
        `INSERT INTO product_price (id, variant, price) VALUES ($1, $2, $3)
         ON CONFLICT (id, variant) DO UPDATE SET price = EXCLUDED.price`,
        [id, v, price]
      );
    }
    return;
  }
  const data = await getPriceOverrides();
  if (price === null) delete data[id + '|' + v]; else data[id + '|' + v] = price;
  fs.writeFileSync(PRICE_FILE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------- Правки описания и веса блюд (админ-панель) ----------
// Возвращает { id блюда: { description?, weight?, variantWeights?: { id варианта: вес } } }
async function getProductEdits() {
  if (mode === 'postgres') {
    const r = await pool.query('SELECT id, data FROM product_edit');
    const out = {};
    r.rows.forEach((row) => { out[row.id] = row.data; });
    return out;
  }
  try { return JSON.parse(fs.readFileSync(EDITS_FILE_PATH, 'utf-8')); } catch (e) { return {}; }
}
// data = объект с правками; data = null — убрать все правки блюда
async function setProductEdit(id, data) {
  if (mode === 'postgres') {
    if (data === null) await pool.query('DELETE FROM product_edit WHERE id = $1', [id]);
    else await pool.query(
      `INSERT INTO product_edit (id, data) VALUES ($1, $2::jsonb)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`, [id, JSON.stringify(data)]);
    return;
  }
  const all = await getProductEdits();
  if (data === null) delete all[id]; else all[id] = data;
  fs.writeFileSync(EDITS_FILE_PATH, JSON.stringify(all, null, 2), 'utf-8');
}

// ---------- Чат с оператором ----------
// sender: 'client' (покупатель), 'operator' (кафе), 'system' (автоответ сайта)
function chatFileRead() {
  try { return JSON.parse(fs.readFileSync(CHAT_FILE_PATH, 'utf-8')); } catch (e) { return []; }
}
function chatFileWrite(list) { fs.writeFileSync(CHAT_FILE_PATH, JSON.stringify(list), 'utf-8'); }
const chatRow = (r) => ({ id: Number(r.id), thread: r.thread, sender: r.sender, text: r.text, name: r.name || '', read: !!r.read, at: new Date(r.created_at || r.at).toISOString() });

async function chatAdd(thread, sender, text, name) {
  if (mode === 'postgres') {
    const r = await pool.query(
      'INSERT INTO chat_message (thread, sender, text, name, read) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [thread, sender, text, name || '', sender !== 'client']);
    return chatRow(r.rows[0]);
  }
  const list = chatFileRead();
  const id = (list.length ? list[list.length - 1].id : 0) + 1;
  const row = { id, thread, sender, text, name: name || '', read: sender !== 'client', at: new Date().toISOString() };
  list.push(row); chatFileWrite(list);
  return chatRow(row);
}
// Сообщения переписки с номером больше afterId
async function chatMessages(thread, afterId) {
  const a = Number(afterId) || 0;
  if (mode === 'postgres') {
    const r = await pool.query('SELECT * FROM chat_message WHERE thread = $1 AND id > $2 ORDER BY id LIMIT 300', [thread, a]);
    return r.rows.map(chatRow);
  }
  return chatFileRead().filter((m) => m.thread === thread && m.id > a).map(chatRow);
}
// Список переписок для админки: последнее сообщение, число непрочитанных, имя
async function chatThreads() {
  let msgs;
  if (mode === 'postgres') {
    const r = await pool.query(`
      SELECT * FROM chat_message
      WHERE thread IN (SELECT thread FROM chat_message GROUP BY thread ORDER BY MAX(id) DESC LIMIT 60)
      ORDER BY id`);
    msgs = r.rows.map(chatRow);
  } else {
    msgs = chatFileRead().map(chatRow);
  }
  const map = new Map();
  for (const m of msgs) {
    const t = map.get(m.thread) || { thread: m.thread, name: '', last: null, unread: 0, count: 0 };
    t.count++;
    if (m.name) t.name = m.name;
    if (m.sender !== 'system') t.last = m;
    if (m.sender === 'client' && !m.read) t.unread++;
    map.set(m.thread, t);
  }
  return [...map.values()].filter((t) => t.last).sort((a, b) => b.last.id - a.last.id).slice(0, 60);
}
async function chatMarkRead(thread) {
  if (mode === 'postgres') { await pool.query("UPDATE chat_message SET read = true WHERE thread = $1 AND sender = 'client' AND NOT read", [thread]); return; }
  const list = chatFileRead(); let ch = false;
  list.forEach((m) => { if (m.thread === thread && m.sender === 'client' && !m.read) { m.read = true; ch = true; } });
  if (ch) chatFileWrite(list);
}
async function chatCount(thread, sender) {
  if (mode === 'postgres') {
    const r = await pool.query('SELECT COUNT(*)::int AS n FROM chat_message WHERE thread = $1 AND sender = $2', [thread, sender]);
    return r.rows[0].n;
  }
  return chatFileRead().filter((m) => m.thread === thread && m.sender === sender).length;
}
// Удаляем переписки старше N дней (не храним лишние персональные данные)
async function chatCleanup(days) {
  if (mode === 'postgres') { await pool.query("DELETE FROM chat_message WHERE created_at < now() - ($1 || ' days')::interval", [String(days)]); return; }
  const lim = Date.now() - days * 86400000;
  const list = chatFileRead().filter((m) => new Date(m.at).getTime() >= lim);
  chatFileWrite(list);
}

module.exports = { init, getMode, nextOrderNumber, addOrder, getOrder, listOrders, setStatus, updateOrder, getStopOverrides, setProductStop, getNutritionOverrides, setNutrition, getPriceOverrides, setPrice,
  getProductEdits, setProductEdit, chatAdd, chatMessages, chatThreads, chatMarkRead, chatCount, chatCleanup };
