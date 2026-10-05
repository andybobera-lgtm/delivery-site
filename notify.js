// ==========================================================================
// УВЕДОМЛЕНИЯ О НОВЫХ ЗАКАЗАХ В TELEGRAM
// Работает, если в настройках сайта заданы TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID.
// Если не заданы — просто ничего не отправляет, сайт работает как обычно.
// ==========================================================================

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatOrder(order) {
  const c = order.customer || {};
  const lines = [];
  lines.push(`🔔 <b>Новый оплаченный заказ №${esc(String(order.id).slice(0, 8))}</b>`);
  lines.push('');
  (order.items || []).forEach((it) => {
    lines.push(`• ${esc(it.name)} × ${esc(it.qty)} — ${esc(it.price * it.qty)} ₽`);
  });
  lines.push('');
  lines.push(`💰 <b>Итого: ${esc(order.total)} ₽</b> (оплачено)`);
  if (order.cutleryCount) lines.push(`🍴 Приборов: ${esc(order.cutleryCount)}`);
  lines.push('');
  lines.push(`👤 ${esc(c.name)}`);
  lines.push(`📞 +${esc(c.phone)}`);
  lines.push(`📍 ${esc(c.address)}`);
  if (c.comment) lines.push(`💬 ${esc(c.comment)}`);
  return lines.join('\n');
}

async function notifyPaidOrder(order) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn('Telegram не настроен (нет TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID) — уведомление не отправлено');
    return false;
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatOrder(order),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      console.error('Telegram не принял сообщение:', r.status, await r.text());
      return false;
    }
    return true;
  } catch (err) {
    // Ошибка уведомления не должна ломать обработку оплаты
    console.error('Не удалось отправить уведомление в Telegram:', err.message);
    return false;
  }
}

module.exports = { notifyPaidOrder, formatOrder };
