// ==========================================================================
// ЧАТ С ОПЕРАТОРОМ НА САЙТЕ
// Кнопка внизу слева. Переписка привязана к случайному ключу в браузере клиента (localStorage).
// Пока чат закрыт — сервер не опрашиваем. Открыт — раз в 5 секунд.
// ==========================================================================
(function () {
  if (window.__chatLoaded) return;
  window.__chatLoaded = true;

  var KEY_NAME = 'dachnaya_chat_key', NAME_NAME = 'dachnaya_chat_name', LAST_NAME = 'dachnaya_chat_last', SEEN_NAME = 'dachnaya_chat_seen';
  var seenId = 0; try { seenId = Number(localStorage.getItem(SEEN_NAME)) || 0; } catch (e) {}
  var key = null, lastId = 0, open = false, timer = null, sending = false;
  try { key = localStorage.getItem(KEY_NAME); } catch (e) {}
  if (!key || !/^[A-Za-z0-9_-]{16,64}$/.test(key)) {
    var a = new Uint8Array(18);
    (window.crypto || window.msCrypto).getRandomValues(a);
    key = Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    try { localStorage.setItem(KEY_NAME, key); } catch (e) {}
  }
  var hasHistory = false;
  try { hasHistory = !!localStorage.getItem(LAST_NAME); } catch (e) {}

  var css = '' +
    '#dbchat-btn{position:fixed;left:16px;bottom:20px;z-index:35;display:flex;align-items:center;gap:8px;background:#487648;color:#fff;border:0;border-radius:999px;padding:13px 18px;font:600 15px/1 Onest,-apple-system,sans-serif;cursor:pointer;box-shadow:0 8px 20px rgba(41,74,41,.35)}' +
    '#dbchat-btn svg{width:20px;height:20px}' +
    '#dbchat-btn .dot{display:none;position:absolute;top:-4px;right:-2px;min-width:20px;height:20px;border-radius:10px;background:#d84315;color:#fff;font-size:12px;line-height:20px;text-align:center;padding:0 5px}' +
    'body.cart-open #dbchat-btn,body.no-scroll #dbchat-btn,body:has(#cookie-banner:not([hidden])) #dbchat-btn{opacity:0;pointer-events:none}' +
    '#dbchat{position:fixed;left:16px;bottom:20px;z-index:80;width:360px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 40px);background:#fff;border-radius:18px;box-shadow:0 20px 50px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden;font-family:Onest,-apple-system,sans-serif;color:#152f24}' +
    '#dbchat.open{display:flex}' +
    '#dbchat .h{background:#487648;color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px}' +
    '#dbchat .h b{font-size:16px}#dbchat .h small{display:block;font-size:12px;opacity:.85;margin-top:2px}' +
    '#dbchat .x{background:transparent;border:0;color:#fff;font-size:28px;line-height:1;cursor:pointer;padding:0 4px}' +
    '#dbchat .m{flex:1;overflow-y:auto;padding:14px;background:#f6f4ee;display:flex;flex-direction:column;gap:8px}' +
    '#dbchat .b{max-width:82%;padding:9px 12px;border-radius:14px;font-size:15px;line-height:1.35;white-space:pre-wrap;word-break:break-word}' +
    '#dbchat .b i{display:block;font-style:normal;font-size:11px;opacity:.55;margin-top:3px}' +
    '#dbchat .b.client{align-self:flex-end;background:#487648;color:#fff;border-bottom-right-radius:4px}' +
    '#dbchat .b.operator{align-self:flex-start;background:#fff;border:1px solid #e3e0d6;border-bottom-left-radius:4px}' +
    '#dbchat .b.system{align-self:center;background:#e9efe4;color:#4c5a46;font-size:13px;text-align:center;max-width:92%}' +
    '#dbchat .hello{align-self:center;text-align:center;color:#6b7266;font-size:14px;padding:10px 6px}' +
    '#dbchat .f{border-top:1px solid #e8e5dc;padding:10px;background:#fff}' +
    '#dbchat .nm{width:100%;padding:8px 10px;margin-bottom:8px;border:1px solid #d9d6cb;border-radius:10px;font:15px Onest,sans-serif;box-sizing:border-box}' +
    '#dbchat .r{display:flex;gap:8px}' +
    '#dbchat textarea{flex:1;border:1px solid #d9d6cb;border-radius:12px;padding:10px;font:16px Onest,sans-serif;resize:none;height:44px;box-sizing:border-box}' +
    '#dbchat .s{background:#487648;color:#fff;border:0;border-radius:12px;padding:0 16px;font:600 15px Onest,sans-serif;cursor:pointer}' +
    '#dbchat .s:disabled{opacity:.5}' +
    '#dbchat .n{font-size:11px;color:#8a8f86;margin-top:6px;line-height:1.3}#dbchat .n a{color:#487648}' +
    '@media(max-width:560px){#dbchat{left:0;right:0;bottom:0;top:0;width:100%;max-width:none;height:100%;max-height:none;border-radius:0}#dbchat-btn{left:12px;bottom:16px;padding:12px 15px}#dbchat-btn span.t{display:none}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var btn = document.createElement('button');
  btn.id = 'dbchat-btn'; btn.type = 'button'; btn.setAttribute('aria-label', 'Чат с оператором');
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg><span class="t">Чат</span><span class="dot"></span>';
  var box = document.createElement('div');
  box.id = 'dbchat';
  box.innerHTML = '<div class="h"><div><b>Чат с оператором</b><small>Отвечаем в рабочее время</small></div><button class="x" type="button" aria-label="Закрыть">×</button></div>' +
    '<div class="m"></div>' +
    '<div class="f"><input class="nm" type="text" maxlength="40" placeholder="Ваше имя (необязательно)" />' +
    '<div class="r"><textarea maxlength="1000" placeholder="Напишите сообщение…"></textarea><button class="s" type="button">Отправить</button></div>' +
    '<div class="n">Не пишите в чат данные карты. Отправляя сообщение, вы соглашаетесь с <a href="/legal/privacy-policy.html" target="_blank" rel="noopener">обработкой персональных данных</a>. Переписка хранится до 60 дней.</div></div>';
  document.body.appendChild(btn); document.body.appendChild(box);

  var msgs = box.querySelector('.m'), ta = box.querySelector('textarea'), nm = box.querySelector('.nm'), sb = box.querySelector('.s');
  var dot = btn.querySelector('.dot');
  try { nm.value = localStorage.getItem(NAME_NAME) || ''; } catch (e) {}

  function hm(iso) { try { return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function add(m) {
    var d = document.createElement('div');
    d.className = 'b ' + m.sender;
    d.textContent = m.text;
    if (m.sender !== 'system') { var t = document.createElement('i'); t.textContent = hm(m.at); d.appendChild(t); }
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    if (m.id > lastId) lastId = m.id;
  }
  function hello() {
    if (msgs.children.length) return;
    var h = document.createElement('div'); h.className = 'hello'; h.id = 'dbchat-hello';
    h.textContent = 'Задайте вопрос по меню, заказу или доставке — оператор ответит здесь.';
    msgs.appendChild(h);
  }
  function api(method, path, body) {
    return fetch(path, { method: method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'err'); return d; }); });
  }
  var unreadSeen = 0;
  function markSeen() { seenId = lastId; try { localStorage.setItem(SEEN_NAME, String(seenId)); } catch (e) {} }
  function poll() {
    api('GET', '/api/chat?key=' + key + '&after=' + lastId).then(function (list) {
      var hh = document.getElementById('dbchat-hello'); if (hh && list.length) hh.remove();
      var fresh = 0;
      list.forEach(function (m) { add(m); if (m.sender === 'operator' && m.id > seenId) fresh++; });
      if (open) markSeen();
      else if (fresh) { unreadSeen += fresh; dot.style.display = 'block'; dot.textContent = unreadSeen; }
    }).catch(function () {});
  }
  function schedule() {
    clearInterval(timer);
    if (open) timer = setInterval(poll, 5000);
    else if (hasHistory) timer = setInterval(poll, 30000);   // раньше не писал — сервер не нагружаем
  }
  function show() {
    open = true; box.classList.add('open'); btn.style.display = 'none';
    unreadSeen = 0; dot.style.display = 'none';
    hello();
    poll(); schedule(); markSeen();
    setTimeout(function () { ta.focus(); }, 50);
    if (window.__goal) try { window.__goal('chat_open'); } catch (e) {}
  }
  function hide() { markSeen(); open = false; box.classList.remove('open'); btn.style.display = ''; schedule(); }
  btn.addEventListener('click', show);
  box.querySelector('.x').addEventListener('click', hide);

  function send() {
    var text = ta.value.trim();
    if (!text || sending) return;
    sending = true; sb.disabled = true;
    var name = nm.value.trim();
    try { localStorage.setItem(NAME_NAME, name); } catch (e) {}
    api('POST', '/api/chat', { key: key, text: text, name: name }).then(function (d) {
      ta.value = '';
      var hh = document.getElementById('dbchat-hello'); if (hh) hh.remove();
      add(d.message);
      if (d.reply) add(d.reply);
      try { localStorage.setItem(LAST_NAME, '1'); } catch (e) {}
      hasHistory = true;
      nm.style.display = 'none';
    }).catch(function (e) {
      var d = document.createElement('div'); d.className = 'b system';
      d.textContent = 'Не удалось отправить сообщение. Проверьте интернет и попробуйте ещё раз.';
      msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight;
      setTimeout(function () { d.remove(); }, 5000);
    }).then(function () { sending = false; sb.disabled = false; });
  }
  sb.addEventListener('click', send);
  ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

  // Если клиент уже писал — тихо проверяем ответы оператора раз в 30 секунд и показываем число на кнопке
  if (hasHistory) { nm.style.display = 'none'; poll(); }
  schedule();
})();
