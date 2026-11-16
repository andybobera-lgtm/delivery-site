// ==========================================================================
// ВЫЗОВ КУРЬЕРА ЧЕРЕЗ ЯНДЕКС ДОСТАВКУ (экспресс-доставка, API для бизнеса)
//
// Как это работает:
//  1) Повар нажимает «Заказ готов» → в админке появляется кнопка «Узнать цену курьера».
//  2) Сайт создаёт заявку в Яндексе (claims/create) и ждёт, пока Яндекс назовёт цену.
//  3) Повар нажимает «Вызвать курьера» → заявка подтверждается (claims/accept), Яндекс ищет курьера.
//  4) Раз в 20 секунд сайт спрашивает у Яндекса статус (claims/info) и показывает его в админке.
//     Когда курьер забрал заказ — заказ сам становится «передан курьеру», когда доставил — «доставлен».
//
// Если токена нет (переменная YANDEX_DELIVERY_TOKEN не задана) — ничего из этого не работает,
// сайт и админка ведут себя как раньше.
//
// Настройки (в панели Timeweb, переменные окружения):
//   YANDEX_DELIVERY_TOKEN  — токен из личного кабинета Яндекс Доставки (обязательно)
//   YANDEX_DELIVERY_AUTO   — «1»: сразу вызывать курьера при «Заказ готов», без кнопки (по умолчанию выключено)
//   YANDEX_TAXI_CLASS      — express (на авто, по умолчанию) или courier (пеший курьер)
//   PICKUP_ADDRESS         — адрес лавки текстом, как его увидит курьер (например «Москва, ул. …, д. …»)
//   PICKUP_PHONE           — телефон, по которому курьер позвонит в лавку (+7…)
//   PICKUP_NAME, PICKUP_EMAIL — имя и почта контакта в лавке (необязательно)
//   YANDEX_DELIVERY_HOST   — адрес API (менять не нужно)
// ==========================================================================

const crypto = require('crypto');

const HOST = process.env.YANDEX_DELIVERY_HOST || 'https://b2b.taxi.yandex.net';
const BASE = HOST.replace(/\/+$/, '') + '/b2b/cargo/integration/v2';

// Статусы, после которых спрашивать Яндекс уже не нужно
const TERMINAL = new Set([
  'delivered_finish', 'returned_finish', 'failed', 'estimating_failed',
  'cancelled', 'cancelled_with_payment', 'cancelled_by_taxi', 'cancelled_with_items_on_hands',
  'performer_not_found',
]);
// Заявка «живая»: её нельзя создавать заново (иначе вызовем двух курьеров)
const LIVE = new Set([
  'new', 'estimating', 'ready_for_approval', 'accepted', 'performer_lookup', 'performer_draft', 'performer_found',
  'pickup_arrived', 'ready_for_pickup_confirmation', 'pickuped', 'delivery_arrived', 'ready_for_delivery_confirmation',
  'delivered', 'returning', 'return_arrived', 'ready_for_return_confirmation', 'returned',
]);
const OFFER_TTL_MS = 9 * 60 * 1000; // цена от Яндекса действует 10 минут — считаем с запасом

function enabled() { return !!process.env.YANDEX_DELIVERY_TOKEN; }
function autoMode() { return process.env.YANDEX_DELIVERY_AUTO === '1'; }

function pickup() {
  return {
    name: process.env.PICKUP_NAME || 'Дачная Беседка',
    phone: process.env.PICKUP_PHONE || '+79670359843',
    email: process.env.PICKUP_EMAIL || 'mdmbaza@yandex.ru',
    address: process.env.PICKUP_ADDRESS || 'Москва, кулинарная лавка «Дачная Беседка»',
  };
}

async function api(pathName, query, body) {
  const url = new URL(BASE + pathName);
  Object.keys(query || {}).forEach((k) => url.searchParams.set(k, query[k]));
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.YANDEX_DELIVERY_TOKEN,
      'Accept-Language': 'ru',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* не JSON */ }
  if (!r.ok) {
    // В ошибку кладём только код и сообщение Яндекса — без данных покупателя
    const err = new Error('Яндекс Доставка: ' + r.status + ' ' + ((data && (data.message || data.code)) || ''));
    err.status = r.status;
    err.apiCode = data && data.code;
    err.apiMessage = data && data.message;
    throw err;
  }
  return data || {};
}

// Тело заявки: откуда (лавка), куда (адрес клиента), что везём
function buildClaim(order, kitchen) {
  const p = pickup();
  const c = order.customer || {};
  const num = String(order.number || String(order.id).slice(0, 8));
  const phone = '+' + String(c.phone || '').replace(/\D/g, '');
  const items = (order.items || []).map((it) => ({
    title: String(it.name || 'Блюдо').slice(0, 200),
    quantity: Math.max(1, parseInt(it.qty, 10) || 1),
    cost_value: Number(it.price || 0).toFixed(2),
    cost_currency: 'RUB',
    pickup_point: 1,
    dropoff_point: 2,
  }));
  const comment = ['Заказ №' + num + ' (еда, оплачен онлайн)',
    order.cutleryCount ? 'приборов: ' + order.cutleryCount : '',
    c.comment || ''].filter(Boolean).join('. ').slice(0, 1000);
  return {
    items,
    route_points: [
      {
        point_id: 1, visit_order: 1, type: 'source',
        contact: { name: p.name, phone: p.phone, email: p.email },
        address: { fullname: p.address, coordinates: [kitchen[1], kitchen[0]] }, // порядок: долгота, широта
        external_order_id: num,
      },
      {
        point_id: 2, visit_order: 2, type: 'destination',
        contact: { name: String(c.name || 'Клиент').slice(0, 60), phone },
        address: { fullname: String(c.address || '').slice(0, 300), coordinates: [order.geo.lon, order.geo.lat] },
        external_order_id: num,
      },
    ],
    client_requirements: { taxi_class: process.env.YANDEX_TAXI_CLASS || 'express' },
    comment,
    optional_return: false,
    skip_door_to_door: false,
    skip_emergency_notify: true,
  };
}

// Из ответа Яндекса берём только то, что нужно показать в админке
function summarize(info, prev) {
  const offer = info.pricing && info.pricing.offer;
  const performer = info.performer_info || null;
  return {
    claimId: info.id || (prev && prev.claimId),
    status: info.status,
    version: info.version,
    price: offer ? (offer.price_with_vat || offer.price || null) : (prev && prev.price) || null,
    finalPrice: info.pricing && info.pricing.final_price ? info.pricing.final_price : null,
    eta: typeof info.eta === 'number' ? info.eta : null,
    performer: performer ? {
      name: performer.courier_name || '',
      car: [performer.car_color, performer.car_model, performer.car_number].filter(Boolean).join(' '),
    } : (prev && prev.performer) || null,
    createdAt: (prev && prev.createdAt) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: (info.error_messages && info.error_messages[0] && info.error_messages[0].message) || null,
  };
}

async function createClaim(order, kitchen) {
  const info = await api('/claims/create', { request_id: crypto.randomUUID() }, buildClaim(order, kitchen));
  return summarize(info, null);
}
async function getInfo(claimId, prev) {
  return summarize(await api('/claims/info', { claim_id: claimId }), prev);
}
async function acceptClaim(claimId, version) {
  await api('/claims/accept', { claim_id: claimId }, { version });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Создать заявку и дождаться цены (Яндекс считает её за несколько секунд)
async function estimate(order, kitchen) {
  let courier = await createClaim(order, kitchen);
  for (let i = 0; i < 8 && !['ready_for_approval', 'estimating_failed', 'failed'].includes(courier.status); i++) {
    await sleep(2000);
    courier = await getInfo(courier.claimId, courier);
  }
  return courier;
}

// Подтвердить заявку; если цена устарела (прошло больше ~9 минут) — вернёт null, нужно оценить заново
async function confirm(courier) {
  const fresh = await getInfo(courier.claimId, courier);
  if (fresh.status !== 'ready_for_approval') return fresh; // уже подтверждена/изменилась — просто покажем как есть
  if (Date.now() - new Date(courier.createdAt).getTime() > OFFER_TTL_MS) return null;
  await acceptClaim(fresh.claimId, fresh.version);
  return getInfo(fresh.claimId, fresh);
}

const STATUS_TEXT = {
  new: 'Считаем цену…', estimating: 'Считаем цену…', ready_for_approval: 'Цена готова',
  accepted: 'Ищем курьера…', performer_lookup: 'Ищем курьера…', performer_draft: 'Ищем курьера…',
  performer_found: 'Курьер найден', pickup_arrived: 'Курьер приехал в лавку', ready_for_pickup_confirmation: 'Курьер у вас, отдайте заказ',
  pickuped: 'Курьер забрал заказ', delivery_arrived: 'Курьер у клиента', ready_for_delivery_confirmation: 'Курьер вручает заказ',
  delivered: 'Доставлено', delivered_finish: 'Доставлено',
  performer_not_found: 'Курьер не найден', estimating_failed: 'Яндекс не смог посчитать доставку', failed: 'Заявка не выполнена',
  cancelled: 'Заявка отменена', cancelled_with_payment: 'Заявка отменена (платно)', cancelled_by_taxi: 'Курьер отменил заявку',
  cancelled_with_items_on_hands: 'Заявка отменена, заказ у курьера',
  returning: 'Курьер возвращает заказ', return_arrived: 'Курьер вернулся в лавку', returned: 'Заказ возвращён', returned_finish: 'Заказ возвращён',
};

module.exports = { enabled, autoMode, estimate, confirm, getInfo, TERMINAL, LIVE, STATUS_TEXT, OFFER_TTL_MS };
