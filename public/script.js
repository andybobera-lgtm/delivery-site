let products = [];
let cart = {};
let cutleryCount = 0;

const THUMB_COLORS = ['#b5432a', '#c98a3d', '#7a8f5c', '#5c7a8f', '#8f5c7a'];

function colorFor(id) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) % THUMB_COLORS.length;
  return THUMB_COLORS[hash];
}

// Возвращает CSS-стиль и текст для картинки блюда:
// если в products.json у товара заполнено поле "image" — показываем настоящее фото,
// если нет — показываем цветную плашку с первой буквой названия (как сейчас)
function thumbStyleAndText(product) {
  if (product.image) {
    return {
      style: `background-image:url('${product.image}');background-size:cover;background-position:center;`,
      text: '',
    };
  }
  return {
    style: `background:${colorFor(product.id)};`,
    text: (product.name || '?').trim()[0] || '?',
  };
}

/* ================= СОХРАНЕНИЕ КОРЗИНЫ (не пропадает при обновлении страницы) ================= */
const CART_KEY = 'dachnaya_cart_v1';
const CUSTOMER_KEY = 'dachnaya_customer_v1';
let cartRestored = false;

function saveCart() {
  if (!cartRestored) return;
  try { localStorage.setItem(CART_KEY, JSON.stringify({ cart, cutleryCount })); } catch (e) {}
}
function saveCustomer() {
  try {
    localStorage.setItem(CUSTOMER_KEY, JSON.stringify({
      name: document.getElementById('name').value,
      phone: document.getElementById('phone').value,
    }));
  } catch (e) {}
}
function restoreCart() {
  try {
    const saved = JSON.parse(localStorage.getItem(CART_KEY) || 'null');
    if (saved && saved.cart) {
      Object.keys(saved.cart).forEach((key) => {
        const line = saved.cart[key];
        if (!line || typeof line !== 'object' || !/^[\w.:|-]{1,120}$/.test(key)) return; // защита: чужие/испорченные данные пропускаем
        const product = products.find((p) => p.id === line.productId);
        if (!product || !Number.isInteger(line.qty) || line.qty < 1 || line.qty > 50) return; // блюда больше нет в меню — пропускаем
        // в корзину попадают только названия из нашего меню, а не то, что лежит в памяти браузера
        line.name = String(line.name || product.name).replace(/[<>&"'`]/g, '').slice(0, 160);
        if (Array.isArray(line.comboSelections)) {
          line.comboSelections = line.comboSelections
            .filter((s) => s && (product.options || []).some((o) => o.name === s.name) && Number.isInteger(s.count) && s.count > 0)
            .map((s) => ({ name: (product.options.find((o) => o.name === s.name)).name, count: s.count }));
        }
        if (line.type === 'variant') {
          const v = (product.variants || []).find((x) => x.id === line.variantId);
          if (!v) return;
          line.price = v.price; // цену берём актуальную
        } else if (typeof product.price === 'number') {
          line.price = product.price;
        } else return;
        cart[key] = line;
      });
      if (Number.isFinite(saved.cutleryCount)) cutleryCount = Math.max(0, saved.cutleryCount);
    }
    const cust = JSON.parse(localStorage.getItem(CUSTOMER_KEY) || 'null');
    if (cust) {
      if (cust.name) document.getElementById('name').value = cust.name;
      if (cust.phone) document.getElementById('phone').value = cust.phone;
    }
  } catch (e) {}
  cartRestored = true;
  renderCutlery();
  renderCartWidgets();
  cartArmed = true;
}
['name', 'phone'].forEach((id) => document.getElementById(id).addEventListener('input', saveCustomer));

async function loadProducts() {
  const res = await fetch('/api/products');
  products = await res.json();
  renderCategoryNav();
  renderMenu();
  restoreCart();
  cleanCategoryHash();
  openDishFromLink();
}

// Ссылка вида /?dish=shashlyk-lamb (со страницы блюда в поиске): открываем карточку этого блюда
function openDishFromLink() {
  let id = null;
  try { id = new URLSearchParams(location.search).get('dish'); } catch (e) {}
  if (!id) return;
  const p = products.find((x) => x.id === id);
  try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
  if (p) openDetailFor(p);
}

function renderCategoryNav() {
  const categories = [...new Set(products.map((p) => p.category || 'Меню'))];

  const nav = document.getElementById('category-nav');
  nav.innerHTML = '';
  categories.forEach((cat, index) => {
    const a = document.createElement('a');
    a.className = 'category-chip' + (index === 0 ? ' active' : '');
    a.href = '#cat-' + slug(cat);
    a.textContent = cat;
    // не меняем адрес страницы: ссылка всегда одна
    a.addEventListener('click', (e) => { e.preventDefault(); goToCategory(a.getAttribute('href')); });
    nav.appendChild(a);
  });

  const mobileList = document.getElementById('mobile-menu-list');
  mobileList.innerHTML = '';
  categories.forEach((cat) => {
    const a = document.createElement('a');
    a.href = '#cat-' + slug(cat);
    a.textContent = cat;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      closeMobileMenu();
      goToCategory(a.getAttribute('href'));
    });
    mobileList.appendChild(a);
  });

  setupCategoryScrollSpy();
}

// Прокрутка к разделу меню без изменения адреса страницы
function goToCategory(hash) {
  const el = document.getElementById(String(hash).replace(/^#/, ''));
  if (el) el.scrollIntoView({ block: 'start' });
}

// Если человек пришёл по старой ссылке вида /#cat-...: показываем раздел и убираем «хвост» из адреса
function cleanCategoryHash() {
  let h = location.hash;
  if (!h) return;
  try { h = decodeURIComponent(h); } catch (e) {}
  if (!/^#cat-/.test(h)) return;
  goToCategory(h);
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
}

let lastActiveCat = null;
function setActiveCategoryChip(catSlug) {
  if (catSlug === lastActiveCat) return;
  lastActiveCat = catSlug;
  const nav = document.getElementById('category-nav');
  document.querySelectorAll('.category-chip').forEach((chip) => {
    const isActive = chip.getAttribute('href') === '#cat-' + catSlug;
    chip.classList.toggle('active', isActive);
    if (isActive && nav) {
      // прокручиваем только саму полосу категорий (не всю страницу), чтобы активная была по центру
      const c = chip.getBoundingClientRect();
      const n = nav.getBoundingClientRect();
      nav.scrollBy({ left: c.left - n.left - (n.width - c.width) / 2, behavior: 'smooth' });
    }
  });
}

// Подсвечиваем категорию, в разделе которой сейчас находимся при прокрутке
let categorySpyBound = false;
function setupCategoryScrollSpy() {
  if (categorySpyBound) return;
  categorySpyBound = true;
  let ticking = false;
  const update = () => {
    ticking = false;
    if (scrollLockY !== null) return; // страница заморожена под открытым окном
    const sections = [...document.querySelectorAll('.menu-section')];
    if (!sections.length) return;
    const line = 160; // линия чуть ниже шапки и панели категорий
    let current = sections[0];
    for (const sec of sections) {
      if (sec.getBoundingClientRect().top <= line) current = sec;
      else break;
    }
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    if (atBottom) current = sections[sections.length - 1];
    setActiveCategoryChip(current.id.replace('cat-', ''));
  };
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
  window.addEventListener('resize', update);
  update();
}

function openMobileMenu() {
  document.getElementById('mobile-menu-drawer').classList.add('open');
  document.getElementById('mobile-menu-overlay').classList.add('open');
  updateScrollLock();
}
function closeMobileMenu() {
  document.getElementById('mobile-menu-drawer').classList.remove('open');
  document.getElementById('mobile-menu-overlay').classList.remove('open');
  updateScrollLock();
}
document.getElementById('mobile-menu-btn').addEventListener('click', openMobileMenu);
document.getElementById('mobile-menu-close').addEventListener('click', closeMobileMenu);
document.getElementById('mobile-menu-overlay').addEventListener('click', closeMobileMenu);

function slug(text) {
  return text.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-');
}

function renderMenu() {
  const container = document.getElementById('menu-sections');
  container.innerHTML = '';
  // страница категории (/menu/...): показываем только одну категорию, заголовок уже есть сверху страницы
  const only = window.ONLY_CATEGORY || null;
  const categories = [...new Set(products.map((p) => p.category || 'Меню'))].filter((c) => !only || c === only);

  categories.forEach((cat) => {
    const section = document.createElement('section');
    section.className = 'menu-section';
    section.id = 'cat-' + slug(cat);

    if (!only) {
      const heading = document.createElement('h2');
      heading.textContent = cat;
      section.appendChild(heading);
    }

    const grid = document.createElement('div');
    grid.className = 'products-grid';
    products.filter((p) => (p.category || 'Меню') === cat).forEach((p) => {
      grid.appendChild(renderProductCard(p));
    });

    section.appendChild(grid);
    container.appendChild(section);
  });
}

/* ================= КАРТОЧКА ТОВАРА ================= */
function renderProductCard(p) {
  const card = document.createElement('div');
  card.className = 'product-card';
  card.dataset.id = p.id;

  const thumb = document.createElement('div');
  thumb.className = 'product-thumb';
  const thumbData = thumbStyleAndText(p);
  thumb.style.cssText = thumbData.style;
  thumb.textContent = thumbData.text;

  const body = document.createElement('div');
  body.className = 'product-body';
  body.innerHTML = `
    <h3><a class="card-link" href="/dish/${p.id}">${p.name}</a></h3>
    <div class="product-meta">${p.weight || ''}</div>
    <div class="product-footer">
      <div class="card-action"></div>
    </div>
  `;

  card.appendChild(thumb);
  card.appendChild(body);

  card.addEventListener('click', (e) => {
    if (e.target.closest('.card-action')) return;
    if (e.target.closest('a')) e.preventDefault(); // ссылка на страницу блюда нужна поисковикам; людям открываем окно блюда
    openDetailFor(p);
  });

  renderCardAction(card, p);
  return card;
}

function openDetailFor(p) {
  if (p.type === 'variant') openVariantPicker(p);
  else if (p.type === 'combo') openComboPicker(p);
  else openSimpleDetail(p);
}

/* Кнопка/счётчик внутри карточки — объединённая "цена + плюс" */
function renderCardAction(card, product) {
  const slot = card.querySelector('.card-action');

  if (typeof product.price !== 'number' && product.type !== 'combo') {
    slot.innerHTML = `<span class="no-price-note">уточняйте</span>`;
    return;
  }

  if (product.type === 'combo') {
    const old = product.oldPrice ? `<span class="old-price">${product.oldPrice} ₽</span>` : '';
    slot.innerHTML = `<button class="view-btn">${old}<span class="cur-price">${product.price} ₽</span><span class="btn-arrow">→</span></button>`;
    slot.querySelector('.view-btn').addEventListener('click', () => openComboPicker(product));
    return;
  }

  if (product.type === 'variant') {
    const totalQty = totalQtyForProduct(product.id);
    if (totalQty === 0) {
      slot.innerHTML = `<button class="view-btn"><span class="cur-price">${product.price} ₽</span><span class="btn-arrow">→</span></button>`;
      slot.querySelector('.view-btn').addEventListener('click', () => openVariantPicker(product));
    } else {
      slot.innerHTML = `<div class="qty-stepper" title="Изменить в корзине"><span>${totalQty}</span></div>`;
      slot.querySelector('.qty-stepper').addEventListener('click', () => openVariantPicker(product));
    }
    return;
  }

  const key = product.id;
  const qty = cart[key] ? cart[key].qty : 0;

  if (qty === 0) {
    slot.innerHTML = `<button class="view-btn"><span class="cur-price">${product.price} ₽</span><span class="btn-arrow">→</span></button>`;
    slot.querySelector('.view-btn').addEventListener('click', () => openSimpleDetail(product));
  } else {
    slot.innerHTML = `
      <div class="qty-stepper">
        <button data-action="minus">−</button>
        <span>${qty}</span>
        <button data-action="plus">+</button>
      </div>
    `;
    slot.querySelector('[data-action="minus"]').addEventListener('click', () => {
      changeSimpleQty(product, -1);
      renderCardAction(card, product);
    });
    slot.querySelector('[data-action="plus"]').addEventListener('click', () => {
      changeSimpleQty(product, 1);
      renderCardAction(card, product);
    });
  }
}

function totalQtyForProduct(productId) {
  return Object.values(cart)
    .filter((line) => line.productId === productId)
    .reduce((sum, line) => sum + line.qty, 0);
}

/* ================= ОБЫЧНЫЕ ТОВАРЫ ================= */
function addSimpleToCart(product) {
  const key = product.id;
  if (!cart[key]) {
    cart[key] = { productId: product.id, type: 'simple', name: product.name, price: product.price, qty: 0 };
  }
  cart[key].qty += 1;
  if (window.__goal) window.__goal('add_to_cart', { item: product.name, price: product.price });
  renderCartWidgets();
}

function changeSimpleQty(product, delta) {
  const key = product.id;
  if (!cart[key]) return;
  cart[key].qty += delta;
  if (cart[key].qty <= 0) delete cart[key];
  renderCartWidgets();
}

/* ================= ОБЩЕЕ: показать/скрыть окно с анимацией ================= */
let scrollLockY = null;
function updateScrollLock() {
  // на компьютере корзина закреплена справа и не блокирует страницу — меню можно листать
  const deskCart = window.matchMedia('(min-width: 900px)').matches;
  const anyOpen = !!document.querySelector('.picker-modal.open, ' + (deskCart ? '' : '.cart-drawer.open, ') + '.address-modal.open, .legal-modal.open, .mobile-menu-drawer.open, .info-modal.open');
  // пока открыто окно — страница под ним не прокручивается (листается только само окно).
  // На iPhone одного overflow:hidden мало, поэтому страницу «замораживаем» на месте (position:fixed)
  if (anyOpen && scrollLockY === null) {
    scrollLockY = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.style.top = (-scrollLockY) + 'px';
  }
  document.documentElement.classList.toggle('no-scroll', anyOpen);
  document.body.classList.toggle('no-scroll', anyOpen);
  if (!anyOpen && scrollLockY !== null) {
    const y = scrollLockY;
    scrollLockY = null;
    document.body.style.top = '';
    const root = document.documentElement;
    const prev = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto'; // вернуться на то же место мгновенно, без прокрутки
    window.scrollTo(0, y);
    root.style.scrollBehavior = prev;
  }
}
/* Карточка блюда «вылетает» из того места, где нажали (компьютер) */
let lastOpenRect = null;
document.addEventListener('click', (e) => {
  const c = e.target.closest && e.target.closest('.product-card, .upsell-card');
  lastOpenRect = c ? c.getBoundingClientRect() : null;
}, true);
function setFlyFrom(modal) {
  const desk = window.matchMedia('(min-width: 641px)').matches;
  if (!desk || !lastOpenRect || modal.classList.contains('open')) { modal.style.setProperty('--fx', '0px'); modal.style.setProperty('--fy', '0px'); modal.style.setProperty('--fs', '0.9'); return; }
  const cartShift = document.body.classList.contains('cart-open') && window.matchMedia('(min-width: 900px)').matches ? 420 : 0;
  const cx = (window.innerWidth - cartShift) / 2, cy = window.innerHeight / 2;
  const r = lastOpenRect;
  const fx = r.left + r.width / 2 - cx, fy = r.top + r.height / 2 - cy;
  const fs = Math.max(0.3, Math.min(0.8, r.width / (modal.offsetWidth || 900)));
  modal.style.setProperty('--fx', fx.toFixed(0) + 'px');
  modal.style.setProperty('--fy', fy.toFixed(0) + 'px');
  modal.style.setProperty('--fs', fs.toFixed(3));
}
function showPicker() {
  const modal = document.getElementById('picker-modal');
  if (!modal.classList.contains('open')) { setFlyFrom(modal); void modal.offsetWidth; }
  document.getElementById('picker-overlay').classList.add('open');
  modal.classList.add('open');
  updateScrollLock();
}
function closePicker() {
  document.getElementById('picker-overlay').classList.remove('open');
  const pm = document.getElementById('picker-modal');
  pm.style.setProperty('--fx', '0px'); pm.style.setProperty('--fy', '0px'); pm.style.setProperty('--fs', '0.94');
  document.getElementById('picker-modal').classList.remove('open');
  document.getElementById('picker-modal').dataset.pid = '';
  updateScrollLock();
  refreshAllCards();
}
document.getElementById('picker-overlay').addEventListener('click', closePicker);

/* ================= КБЖУ ================= */
function formatWeightGrams(g) {
  if (!g) return '';
  if (g >= 1000) {
    const kg = g / 1000;
    return (Number.isInteger(kg) ? kg : kg.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')) + ' кг';
  }
  return Math.round(g) + ' г';
}

function nutritionHtml(nutrition) {
  if (!nutrition || !nutrition.per100) return '';
  const hasPortion = !!nutrition.perPortion;
  const initial = hasPortion ? nutrition.perPortion : nutrition.per100;
  return `
    <div class="nutrition-block">
      <div class="nutrition-tabs">
        ${hasPortion ? `<button type="button" class="nutrition-tab active" data-mode="portion">На позицию ${formatWeightGrams(nutrition.perPortion.weight)}</button>` : ''}
        <button type="button" class="nutrition-tab ${hasPortion ? '' : 'active'}" data-mode="100">На 100 г</button>
      </div>
      <div class="nutrition-tiles">
        <div class="nutrition-tile"><span class="nutrition-value" data-field="kcal">${initial.kcal}</span><span class="nutrition-label">ккал</span></div>
        <div class="nutrition-tile"><span class="nutrition-value" data-field="protein">${initial.protein}</span><span class="nutrition-label">белки</span></div>
        <div class="nutrition-tile"><span class="nutrition-value" data-field="fat">${initial.fat}</span><span class="nutrition-label">жиры</span></div>
        <div class="nutrition-tile"><span class="nutrition-value" data-field="carbs">${initial.carbs}</span><span class="nutrition-label">углеводы</span></div>
      </div>
    </div>
  `;
}

function attachNutritionBlock(nutrition) {
  if (!nutrition) return;
  const block = document.querySelector('.nutrition-block');
  if (!block) return;
  const tabs = block.querySelectorAll('.nutrition-tab');
  const values = {
    kcal: block.querySelector('[data-field="kcal"]'),
    protein: block.querySelector('[data-field="protein"]'),
    fat: block.querySelector('[data-field="fat"]'),
    carbs: block.querySelector('[data-field="carbs"]'),
  };
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const mode = tab.dataset.mode;
      const src = mode === '100' ? nutrition.per100 : (nutrition.perPortion || nutrition.per100);
      values.kcal.textContent = src.kcal;
      values.protein.textContent = src.protein;
      values.fat.textContent = src.fat;
      values.carbs.textContent = src.carbs;
      tabs.forEach((t) => t.classList.toggle('active', t === tab));
    });
  });
}

function pickerShell(product, bodyHtml, footerHtml) {
  const modal = document.getElementById('picker-modal');
  const thumbData = thumbStyleAndText(product);
  // при перерисовке (нажали + или −) сохраняем положение прокрутки, чтобы окно не прыгало вверх
  const same = modal.classList.contains('open') && modal.dataset.pid === product.id;
  const prevScroller = modal.querySelector('.picker-scroll');
  const prevBody = modal.querySelector('.picker-body');
  const prevScrollTop = same && prevScroller ? prevScroller.scrollTop : 0;
  const prevBodyTop = same && prevBody ? prevBody.scrollTop : 0;
  modal.dataset.pid = product.id;
  modal.innerHTML = `
    <button class="cart-close" id="picker-close" aria-label="Закрыть">✕</button>
    <div class="picker-scroll">
      <div class="picker-photo" style="${thumbData.style}">${thumbData.text}</div>
      <div class="picker-header">
        <h3>${product.name}</h3>
      </div>
      <div class="picker-body">${bodyHtml}</div>
    </div>
    <div class="picker-footer">${footerHtml}</div>
  `;
  // при перерисовке (нажали + или −) возвращаем прокрутку на прежнее место, чтобы окно не прыгало вверх
  const newScroller = modal.querySelector('.picker-scroll');
  if (newScroller) newScroller.scrollTop = prevScrollTop;
  const newBody = modal.querySelector('.picker-body');
  if (newBody) newBody.scrollTop = prevBodyTop;
  document.getElementById('picker-close').addEventListener('click', closePicker);
}

/* ================= ОПИСАНИЕ ОБЫЧНОГО ТОВАРА ================= */
function openSimpleDetail(product) {
  const noPrice = typeof product.price !== 'number';

  function render() {
    const qty = cart[product.id] ? cart[product.id].qty : 0;
    const body = `
      ${product.description ? `<div class="picker-description">${product.description}</div>` : ''}
      <div class="product-meta">${product.weight || ''}</div>
      ${nutritionHtml(product.nutrition)}
    `;
    const footer = noPrice
      ? `<div class="no-price-note">Цену уточняйте при оформлении заказа</div>`
      : qty === 0
        ? `<button class="buy-btn wide" id="detail-add"><span class="cur-price">${product.price} ₽</span><span class="btn-plus">+</span></button>`
        : `<div style="display:flex;align-items:center;justify-content:space-between;">
             <div class="qty-stepper" style="background:var(--accent);">
               <button id="detail-minus" style="color:white;">−</button>
               <span style="color:white;">${qty}</span>
               <button id="detail-plus" style="color:white;">+</button>
             </div>
             <span style="font-weight:700;color:var(--accent);">${product.price * qty} ₽</span>
           </div>`;

    pickerShell(product, body, footer);
    attachNutritionBlock(product.nutrition);

    if (!noPrice) {
      if (qty === 0) {
        document.getElementById('detail-add').addEventListener('click', () => { addSimpleToCart(product); render(); });
      } else {
        document.getElementById('detail-plus').addEventListener('click', () => { changeSimpleQty(product, 1); render(); });
        document.getElementById('detail-minus').addEventListener('click', () => { changeSimpleQty(product, -1); render(); });
      }
    }
    showPicker();
  }
  render();
}

/* Пустой квадратик → после нажатия счётчик «− 1 +» (для вариантов и наборов) */
function choiceControl(count, optId, plusDisabled) {
  const dis = plusDisabled ? 'disabled' : '';
  if (count === 0) {
    return `<button type="button" class="choice-box" data-opt="${optId}" data-action="plus" ${dis} aria-label="Выбрать"></button>`;
  }
  return `<div class="choice-stepper">
    <button type="button" data-opt="${optId}" data-action="minus" aria-label="Меньше">−</button>
    <span>${count}</span>
    <button type="button" data-opt="${optId}" data-action="plus" ${dis} aria-label="Больше">+</button>
  </div>`;
}

/* ================= ХИНКАЛ (ВАРИАНТЫ) ================= */
function openVariantPicker(product) {
  function render() {
    const rows = product.variants.map((v) => {
      const key = product.id + '::' + v.id;
      const qty = cart[key] ? cart[key].qty : 0;
      return `
        <div class="variant-option" data-variant-id="${v.id}">
          <div class="variant-option-info">
            <div>${v.label}</div>
            <div class="product-meta">${v.weight}</div>
          </div>
          <div style="display:flex;align-items:center;gap:12px;">
            <span class="variant-option-price">${v.price} ₽</span>
            ${choiceControl(qty, v.id, false)}
          </div>
        </div>
      `;
    }).join('');

    const body = (product.description ? `<div class="picker-description">${product.description}</div>` : '') + rows + nutritionHtml(product.nutrition);
    pickerShell(product, body, `<button class="checkout-btn" id="picker-done">Готово</button>`);
    attachNutritionBlock(product.nutrition);

    document.querySelectorAll('.variant-option').forEach((row) => {
      const variantId = row.dataset.variantId;
      const variant = product.variants.find((v) => v.id === variantId);
      const key = product.id + '::' + variantId;

      const addOne = (e) => {
        if (e) e.stopPropagation();
        if (!cart[key]) cart[key] = { productId: product.id, type: 'variant', variantId, name: product.name + ' (' + variant.label + ')', price: variant.price, qty: 0 };
        cart[key].qty += 1;
        if (window.__goal) window.__goal('add_to_cart', { item: product.name, price: variant.price });
        renderCartWidgets();
        render();
      };
      row.querySelector('[data-action="plus"]').addEventListener('click', addOne);
      if (!cart[key]) row.addEventListener('click', (e) => { if (!e.target.closest('button')) addOne(); });
      row.querySelector('[data-action="minus"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!cart[key]) return;
        cart[key].qty -= 1;
        if (cart[key].qty <= 0) delete cart[key];
        renderCartWidgets();
        render();
      });
    });

    document.getElementById('picker-done').addEventListener('click', closePicker);
    showPicker();
  }
  render();
}

/* ================= НАБОРЫ (ЧУДУ) ================= */
function openComboPicker(product) {
  const selection = {};
  product.options.forEach((o) => { selection[o.id] = 0; });

  function totalCount() { return Object.values(selection).reduce((a, b) => a + b, 0); }
  function meatCount() { return product.options.filter((o) => o.isMeat).reduce((s, o) => s + selection[o.id], 0); }

  function render() {
    const rows = product.options.map((o) => {
      const count = selection[o.id];
      const atMeatLimit = o.isMeat && meatCount() >= product.meatMax;
      const atTotalLimit = totalCount() >= product.totalSlots;
      const plusDisabled = atTotalLimit || atMeatLimit;
      return `
        <div class="combo-option-row" data-opt-row="${o.id}">
          <span class="combo-option-name">${o.name}</span>
          ${choiceControl(count, o.id, plusDisabled)}
        </div>
      `;
    }).join('');

    const body = `
      ${product.description ? `<div class="picker-description">${product.description}</div>` : ''}
      <div class="combo-progress">Выбрано: <b>${totalCount()} / ${product.totalSlots}</b></div>
      ${rows}
      ${nutritionHtml(product.nutrition)}
    `;
    const footer = `
      <button class="buy-btn wide" id="picker-done" ${totalCount() === product.totalSlots ? '' : 'disabled style="opacity:0.5"'}>
        <span class="cur-price">${product.price} ₽</span><span class="btn-plus">+</span>
      </button>
    `;
    pickerShell(product, body, footer);
    attachNutritionBlock(product.nutrition);

    document.querySelectorAll('[data-action="plus"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.opt;
        const opt = product.options.find((o) => o.id === id);
        if (totalCount() >= product.totalSlots) return;
        if (opt.isMeat && meatCount() >= product.meatMax) return;
        selection[id] += 1;
        render();
      });
    });
    document.querySelectorAll('[data-action="minus"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.opt;
        if (selection[id] > 0) selection[id] -= 1;
        render();
      });
    });

    // нажатие на всю строку (не только на квадратик) тоже выбирает позицию
    document.querySelectorAll('[data-opt-row]').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const id = row.dataset.optRow;
        const opt = product.options.find((o) => o.id === id);
        if (selection[id] > 0 || totalCount() >= product.totalSlots) return;
        if (opt.isMeat && meatCount() >= product.meatMax) return;
        selection[id] += 1;
        render();
      });
    });

    if (totalCount() === product.totalSlots) {
      document.getElementById('picker-done').addEventListener('click', () => {
        const comboSelections = product.options.filter((o) => selection[o.id] > 0).map((o) => ({ name: o.name, count: selection[o.id] }));
        const key = product.id + '::' + Date.now();
        cart[key] = { productId: product.id, type: 'combo', name: product.name, price: product.price, qty: 1, comboSelections };
        if (window.__goal) window.__goal('add_to_cart', { item: product.name, price: product.price });
        renderCartWidgets();
        closePicker();
      });
    }
    showPicker();
  }
  render();
}

function refreshAllCards() {
  document.querySelectorAll('.product-card').forEach((card) => {
    const product = products.find((p) => p.id === card.dataset.id);
    if (product) renderCardAction(card, product);
  });
}

/* ================= ИТОГИ КОРЗИНЫ ================= */
function cartTotal() {
  return Object.values(cart).reduce((sum, line) => sum + line.price * line.qty, 0);
}
function cartCount() {
  return Object.values(cart).reduce((sum, line) => sum + line.qty, 0);
}

/* ================= ДОСТАВКА: минимальный заказ, стоимость, бесплатно от суммы ================= */
let deliveryCfg = { minOrder: 1000, deliveryFee: 250, freeDeliveryFrom: 3000, farFee: 500, farFeeFree: 200, nearRadius: 2000, farRadius: 4000, giftFrom: 3000, giftProductId: 'chudu-zelen' };
fetch('/api/config').then((r) => r.json()).then((c) => {
  if (c && c.minOrder) { deliveryCfg = Object.assign({}, deliveryCfg, c); renderCartWidgets(); }
}).catch(() => {});

// Две зоны от кулинарной лавки: ближняя (до nearRadius) и дальняя (до farRadius).
// Зона известна только после того, как человек отметил адрес на карте и сохранил его.
let deliveryGeo = null;    // {lat, lon} сохранённой точки доставки
let deliveryZone = null;   // 'near' | 'far' | null (пока адрес не выбран)

// Расстояние по прямой, метры. Та же формула, что на сервере — цены в корзине и при оплате совпадают.
function distanceM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function roundCoords(c) { return [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6]; }
function zoneOf(coords) {
  const d = distanceM(roundCoords(coords), KITCHEN_COORDS);
  return d <= deliveryCfg.nearRadius ? 'near' : (d <= deliveryCfg.farRadius ? 'far' : 'out');
}
function feeFor(zone, sub) {
  const reduced = sub >= deliveryCfg.freeDeliveryFrom;
  if (zone === 'far') return reduced ? deliveryCfg.farFeeFree : deliveryCfg.farFee;
  return reduced ? 0 : deliveryCfg.deliveryFee;
}

function money(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + '\u00a0₽';
}
function deliveryCost() {
  const sub = cartTotal();
  if (sub === 0) return 0;
  return feeFor(deliveryZone, sub);
}

/* Круглый индикатор: кольцо заполняется по мере набора суммы */
function ringSvg(pct, done) {
  const C = 2 * Math.PI * 17;
  const p = Math.max(0, Math.min(100, pct));
  return `<svg class="db-ring" viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="20" cy="20" r="17" fill="none" stroke="#ebe8e1" stroke-width="4"></circle>
    <circle cx="20" cy="20" r="17" fill="none" stroke="${done ? '#2e9e4f' : '#f15a24'}" stroke-width="4" stroke-linecap="round"
      stroke-dasharray="${(C * p / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 20 20)"></circle>
  </svg>`;
}

function renderDeliveryBar() {
  const box = document.getElementById('delivery-bar');
  if (!box) return;
  const { minOrder, deliveryFee, freeDeliveryFrom, farFeeFree } = deliveryCfg;
  const sub = cartTotal();
  if (sub === 0) { box.innerHTML = ''; box.hidden = true; return; }
  box.hidden = false;

  const far = deliveryZone === 'far';
  const known = deliveryZone === 'near' || far;
  const belowMin = sub < minOrder;
  const reduced = sub >= freeDeliveryFrom;
  const fee = feeFor(deliveryZone, sub);

  const chips = [];
  if (belowMin) {
    chips.push({ pct: sub / minOrder * 100, ico: '⚡', done: false, warn: true,
      title: `Ещё ${money(minOrder - sub)}`, text: 'до минимальной суммы корзины' });
  } else if (!reduced) {
    chips.push({ pct: 100, ico: '✓', done: true, title: 'Минимум набран', text: `заказ от ${money(minOrder)}` });
  }
  if (reduced) {
    chips.push({ pct: 100, ico: '🛵', done: true,
      title: far ? `Доставка ${money(farFeeFree)}` : (known ? 'Доставка бесплатная' : 'Скидка на доставку'),
      text: far ? 'сниженная цена получена' : (known ? 'вы получили её 🎉' : 'точная цена — по адресу') });
  } else {
    const alsoGift = deliveryCfg.giftFrom === freeDeliveryFrom ? ' и чуду в подарок' : '';
    chips.push({ pct: sub / freeDeliveryFrom * 100, ico: '🛵', done: false,
      title: `Ещё ${money(freeDeliveryFrom - sub)}`,
      text: (far ? `до доставки за ${money(farFeeFree)}` : 'до бесплатной доставки') + alsoGift });
  }
  if (deliveryCfg.giftFrom && deliveryCfg.giftFrom !== freeDeliveryFrom) {
    if (sub >= deliveryCfg.giftFrom) chips.push({ pct: 100, ico: '🎁', done: true, title: 'Чуду в подарок', text: 'уже в вашей корзине' });
    else chips.push({ pct: sub / deliveryCfg.giftFrom * 100, ico: '🎁', done: false, title: `Ещё ${money(deliveryCfg.giftFrom - sub)}`, text: 'до чуду в подарок' });
  }

  const feeText = known ? (fee === 0 ? 'бесплатно' : money(fee)) : `от ${money(deliveryFee)}`;
  box.innerHTML = `
    <div class="db-chips">
      ${chips.map((c) => `
        <button type="button" class="db-chip${c.warn ? ' warn' : ''}" data-info="1">
          <span class="db-ring-wrap">${ringSvg(c.pct, c.done)}<span class="db-ring-ico">${c.ico}</span></span>
          <span class="db-chip-text"><b>${c.title}</b><span>${c.text}</span></span>
        </button>`).join('')}
    </div>
    <button type="button" class="db-line" data-info="1">🛵 Доставка ${feeText}<span>Условия доставки ›</span></button>
  `;
  box.querySelectorAll('[data-info]').forEach((b) => b.addEventListener('click', openDeliveryInfo));
}

/* Окно «Условия доставки» (без времени ожидания) */
function openDeliveryInfo() {
  const { minOrder, deliveryFee, freeDeliveryFrom, farFee, farFeeFree, nearRadius, farRadius } = deliveryCfg;
  const sub = cartTotal();
  const km = (m) => (m / 1000).toString().replace('.', ',') + ' км';
  const belowMin = sub < minOrder;
  const near = deliveryZone === 'near', far = deliveryZone === 'far', known = near || far;
  const reduced = sub >= freeDeliveryFrom;
  const addr = (document.getElementById('address').value || '').trim();

  const rows = [`<div class="info-row${belowMin && sub > 0 ? ' now' : ''}"><span>Минимальный заказ</span><b>${money(minOrder)}</b></div>`];
  const zoneRows = (label, low, high, active) => {
    const pre = label ? label + ': ' : '';
    rows.push(`<div class="info-row${active && !reduced ? ' now' : ''}"><span>${pre}при заказе до ${money(freeDeliveryFrom)}</span><b>${money(low)}</b></div>`);
    rows.push(`<div class="info-row${active && reduced ? ' now' : ''}"><span>${pre}при заказе от ${money(freeDeliveryFrom)}</span><b>${high === 0 ? 'бесплатно' : money(high)}</b></div>`);
  };
  if (!known || near) zoneRows(known ? '' : `до ${km(nearRadius)}`, deliveryFee, 0, near);
  if (!known || far) zoneRows(known ? '' : `${km(nearRadius).replace(' км', '')}–${km(farRadius)}`, farFee, farFeeFree, far);

  if (deliveryCfg.giftFrom) rows.push(`<div class="info-row${sub >= deliveryCfg.giftFrom ? ' now' : ''}"><span>🎁 Чуду в подарок при заказе от ${money(deliveryCfg.giftFrom)}</span><b>бесплатно</b></div>`);

  let head;
  if (belowMin) {
    const pct = sub / minOrder * 100;
    head = `<div class="info-top"><span class="db-ring-wrap lg">${ringSvg(pct, false)}<span class="db-ring-ico">⚡</span></span>
            <div class="info-need"><b>Ещё ${money(minOrder - sub)}</b><span>до минимальной суммы корзины</span></div></div>`;
  } else {
    head = `<div class="info-top"><span class="db-ring-wrap lg">${ringSvg(100, true)}<span class="db-ring-ico">✓</span></span>
            <div class="info-need"><b>Минимальная сумма набрана</b><span>можно оформлять заказ</span></div></div>`;
  }

  const modal = document.getElementById('info-modal');
  modal.innerHTML = `
    <button class="cart-close info-close" id="info-close" aria-label="Закрыть">✕</button>
    ${head}
    <h3 class="info-addr">${addr ? addr.replace(/[<>&]/g, '') : 'Условия доставки'}</h3>
    ${addr ? '' : '<div class="info-note">Точная цена зависит от адреса — выберите его на карте при оформлении.</div>'}
    <div class="info-rows">${rows.join('')}</div>
    <button type="button" class="info-ok" id="info-ok">Понятно</button>
  `;
  document.getElementById('info-overlay').classList.add('open');
  modal.classList.add('open');
  document.getElementById('info-close').addEventListener('click', closeDeliveryInfo);
  document.getElementById('info-ok').addEventListener('click', closeDeliveryInfo);
  updateScrollLock();
}
function closeDeliveryInfo() {
  document.getElementById('info-overlay').classList.remove('open');
  document.getElementById('info-modal').classList.remove('open');
  updateScrollLock();
}
document.getElementById('info-overlay').addEventListener('click', closeDeliveryInfo);

function renderTotals() {
  const sub = cartTotal();
  const fee = deliveryCost();
  const subEl = document.getElementById('cart-sub');
  if (subEl) {
    subEl.innerHTML = sub === 0 ? '' :
      `<span>Товары ${money(sub)}</span><span>Доставка ${deliveryZone ? (fee === 0 ? 'бесплатно' : money(fee)) : 'по адресу'}</span>`;
  }
  document.getElementById('cart-total').textContent = (deliveryZone || sub === 0 ? '' : 'от ') + money(sub + fee);
  const btn = document.getElementById('checkout-submit');
  if (btn) {
    const belowMin = sub < deliveryCfg.minOrder;
    btn.disabled = belowMin;
    btn.textContent = belowMin
      ? (sub === 0 ? 'Корзина пуста' : `Добавьте ещё на ${money(deliveryCfg.minOrder - sub)}`)
      : 'Оформить и оплатить';
  }
}

let lastCartCount = 0;
let cartArmed = false; // включается после загрузки сохранённой корзины, чтобы она не открывалась сама при входе на сайт
function renderCartWidgets() {
  const fab = document.getElementById('cart-fab');
  const count = cartCount();
  // Компьютер: добавили блюдо — корзина сама выезжает справа
  const grew = cartArmed && count > lastCartCount;
  lastCartCount = count;

  if (count === 0) {
    fab.hidden = true;
  } else {
    fab.hidden = false;
    document.getElementById('cart-fab-count').textContent = count;
    document.getElementById('cart-fab-total').textContent = cartTotal() + ' ₽';
  }

  renderCartLines();
  renderDeliveryBar();
  renderTotals();
  renderUpsell();
  refreshAllCards();
  saveCart();
  if (grew && window.matchMedia('(min-width: 900px)').matches && !document.getElementById('cart-drawer').classList.contains('open')) openCart();
}

function renderCartLines() {
  const container = document.getElementById('cart-lines');
  const totalEl = document.getElementById('cart-total');
  const keys = Object.keys(cart);

  if (keys.length === 0) {
    container.innerHTML = 'Корзина пуста';
    totalEl.textContent = '0 ₽';
    return;
  }

  container.innerHTML = '';
  keys.forEach((key) => {
    const line = cart[key];
    const product = products.find((p) => p.id === line.productId);
    const thumbData = thumbStyleAndText(product || { id: line.productId, name: line.name });
    const thumbHtml = `<div class="cart-line-thumb" style="${thumbData.style}">${thumbData.text}</div>`;
    const row = document.createElement('div');
    row.className = 'cart-line';

    if (line.type === 'combo') {
      const extra = line.comboSelections
        ? `<ul class="cart-line-composition">${line.comboSelections.map((s) => `<li>${s.name} ×${s.count}</li>`).join('')}</ul>`
        : '';
      row.innerHTML = `
        ${thumbHtml}
        <div class="cart-line-info">
          <span class="cart-line-name">${line.name}</span>
          ${extra}
        </div>
        <div class="cart-line-side">
          <span class="cart-line-price">${line.price} ₽</span>
          <a href="#" data-remove="${key}" class="cart-line-remove">✕</a>
        </div>
      `;
      row.querySelector('[data-remove]').addEventListener('click', (e) => {
        e.preventDefault();
        delete cart[key];
        renderCartWidgets();
      });
    } else {
      row.innerHTML = `
        ${thumbHtml}
        <div class="cart-line-info">
          <span class="cart-line-name">${line.name}</span>
        </div>
        <div class="cart-line-side">
          <div class="qty-stepper">
            <button data-action="minus">−</button>
            <span>${line.qty}</span>
            <button data-action="plus">+</button>
          </div>
          <span class="cart-line-price">${line.price * line.qty} ₽</span>
        </div>
      `;
      row.querySelector('[data-action="minus"]').addEventListener('click', () => {
        line.qty -= 1;
        if (line.qty <= 0) delete cart[key];
        renderCartWidgets();
      });
      row.querySelector('[data-action="plus"]').addEventListener('click', () => {
        line.qty += 1;
        renderCartWidgets();
      });
    }
    container.appendChild(row);
  });

  // Подарок: от giftFrom ₽ чуду добавляется само (сервер добавит его в заказ)
  if (deliveryCfg.giftFrom && cartTotal() >= deliveryCfg.giftFrom) {
    const gp = products.find((p) => p.id === deliveryCfg.giftProductId);
    if (gp) {
      const t = thumbStyleAndText(gp);
      const g = document.createElement('div');
      g.className = 'cart-line cart-gift';
      g.innerHTML = `
        <div class="cart-line-thumb" style="${t.style}">${t.text}</div>
        <div class="cart-line-info">
          <span class="cart-line-name">${gp.name}</span>
          <span class="gift-badge">🎁 В подарок</span>
        </div>
        <div class="cart-line-side"><span class="cart-line-price gift-free">0 ₽</span></div>`;
      container.appendChild(g);
    }
  }

  totalEl.textContent = cartTotal() + ' ₽';
}

/* "Добавить ещё" — товары, которых пока нет в корзине */
function renderUpsell() {
  const container = document.getElementById('cart-upsell');
  if (!container) return;

  const inCartIds = new Set(Object.values(cart).map((l) => l.productId));
  const candidates = products.filter((p) => !inCartIds.has(p.id) && (typeof p.price === 'number' || p.type === 'combo')).slice(0, 8);

  if (candidates.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div class="cart-upsell-title">Добавить ещё</div>
    <div class="cart-upsell-viewport">
      <div class="cart-upsell-row" id="cart-upsell-row"></div>
      <button type="button" class="upsell-arrow upsell-arrow-prev" id="upsell-arrow-prev" aria-label="Назад">‹</button>
      <button type="button" class="upsell-arrow upsell-arrow-next" id="upsell-arrow-next" aria-label="Вперёд">›</button>
    </div>
  `;
  const row = document.getElementById('cart-upsell-row');
  candidates.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'upsell-card';
    const thumbData = thumbStyleAndText(p);
    card.innerHTML = `
      <div class="upsell-thumb" style="${thumbData.style}">${thumbData.text}</div>
      <div class="upsell-name">${p.name}</div>
      <div class="upsell-price">${typeof p.price === 'number' ? p.price + ' ₽' : 'уточняйте'}</div>
    `;
    card.addEventListener('click', () => openDetailFor(p));
    row.appendChild(card);
  });

  const prevBtn = document.getElementById('upsell-arrow-prev');
  const nextBtn = document.getElementById('upsell-arrow-next');
  const scrollStep = () => Math.round(row.clientWidth * 0.8) || 120;
  const updateArrows = () => {
    const maxScroll = row.scrollWidth - row.clientWidth - 1;
    prevBtn.classList.toggle('is-hidden', row.scrollLeft <= 2);
    nextBtn.classList.toggle('is-hidden', row.scrollLeft >= maxScroll || maxScroll <= 0);
  };
  prevBtn.addEventListener('click', () => {
    row.scrollBy({ left: -scrollStep(), behavior: 'smooth' });
  });
  nextBtn.addEventListener('click', () => {
    row.scrollBy({ left: scrollStep(), behavior: 'smooth' });
  });
  row.addEventListener('scroll', updateArrows);
  updateArrows();
}

/* ================= ПРИБОРЫ ================= */
function renderCutlery() {
  document.getElementById('cutlery-count').textContent = cutleryCount;
  saveCart();
}
document.getElementById('cutlery-plus').addEventListener('click', () => {
  cutleryCount += 1;
  renderCutlery();
});
document.getElementById('cutlery-minus').addEventListener('click', () => {
  if (cutleryCount > 0) cutleryCount -= 1;
  renderCutlery();
});

/* ================= КОРЗИНА (ПАНЕЛЬ) ================= */
function openCart() {
  document.getElementById('cart-drawer').classList.add('open');
  document.getElementById('cart-overlay').classList.add('open');
  document.body.classList.add('cart-open');
  updateScrollLock();
}
function closeCart() {
  document.getElementById('cart-drawer').classList.remove('open');
  document.getElementById('cart-overlay').classList.remove('open');
  document.body.classList.remove('cart-open');
  closeAddressModal();
  updateScrollLock();
}
document.getElementById('cart-fab').addEventListener('click', openCart);
document.getElementById('cart-close').addEventListener('click', closeCart);
document.getElementById('cart-overlay').addEventListener('click', closeCart);

/* ================= АДРЕС ДОСТАВКИ ================= */
const KITCHEN_COORDS = [55.673030, 37.614196]; // Кулинарная лавка «Дачная беседка»
let markerPicked = false; // человек сам поставил/передвинул метку (а не оставил её на лавке по умолчанию)
const GEOCODER_API_KEY = 'f9e25577-c9c0-49ce-b057-04356e083b98';
let deliveryMap = null;
let addressMarkerRef = null;

// Яндекс Карты подгружаются только когда человек открыл окно адреса:
// до этого браузер ничего не отправляет в Яндекс (политика конфиденциальности это и обещает).
let ymapsLoading = false;
function loadYandexMaps(done) {
  if (typeof ymaps !== 'undefined') { done(); return; }
  if (ymapsLoading) return;
  ymapsLoading = true;
  const s = document.createElement('script');
  s.src = 'https://api-maps.yandex.ru/2.1/?apikey=' + GEOCODER_API_KEY + '&lang=ru_RU';
  s.onload = () => { ymapsLoading = false; done(); };
  s.onerror = () => { ymapsLoading = false; };
  document.head.appendChild(s);
}

function initDeliveryMap() {
  if (deliveryMap) return;
  if (typeof ymaps === 'undefined') { loadYandexMaps(initDeliveryMap); return; }
  ymaps.ready(() => {
    deliveryMap = new ymaps.Map('delivery-map', {
      center: KITCHEN_COORDS,
      zoom: 12,
      controls: [],
    }, {
      suppressMapOpenBlock: true, // убираем нижнюю плашку-ссылку "Открыть в Яндекс Картах"
    });

    // Отключаем зум по двойному клику/тапу — карта должна приближаться только щипком двумя пальцами
    deliveryMap.behaviors.disable('dblClickZoom');

    // Аккуратные контролы масштаба и геопозиции
    const zoomControl = new ymaps.control.ZoomControl({ options: { size: 'large', float: 'right' } });
    const geoControl = new ymaps.control.GeolocationControl({ options: { float: 'right', noPlacemark: true } });
    deliveryMap.controls.add(zoomControl);
    deliveryMap.controls.add(geoControl);

    // Дальняя зона (до farRadius) и ближняя (до nearRadius)
    deliveryMap.geoObjects.add(new ymaps.Circle([KITCHEN_COORDS, deliveryCfg.farRadius], {}, {
      fillColor: '#f15a2418',
      strokeColor: '#f15a24',
      strokeWidth: 2,
      interactivityModel: 'default#transparent', // круг не перехватывает клики — они проходят на карту
    }));
    deliveryMap.geoObjects.add(new ymaps.Circle([KITCHEN_COORDS, deliveryCfg.nearRadius], {}, {
      fillColor: '#2e7d3220',
      strokeColor: '#2e7d32',
      strokeWidth: 2,
      strokeStyle: 'dash',
      interactivityModel: 'default#transparent',
    }));

    // Метка адреса — её можно перетаскивать, а клик по карте переставляет её на новое место.
    // Сплошной оранжевый круг вместо стандартной синей капли.
    const addressMark = new ymaps.Placemark(KITCHEN_COORDS, {}, {
      preset: 'islands#icon',
      iconColor: '#ff6900',
      draggable: true,
    });
    deliveryMap.geoObjects.add(addressMark);
    addressMarkerRef = addressMark;

    // Определяем адрес по точке напрямую через HTTP Геокодер (со своим отдельным ключом) —
    // это надёжнее встроенной ymaps.geocode(), которая требует специфичный тип ключа.
    // Пробуем оба варианта адреса геокодера на случай, если один из них не подходит для ключа.
    function tryGeocode(url) {
      return fetch(url)
        .then((res) => res.json())
        .then((data) => {
          const member = data?.response?.GeoObjectCollection?.featureMember?.[0];
          if (!member) throw new Error('empty result: ' + JSON.stringify(data));
          return member.GeoObject.name;
        });
    }

    function updateAddressFromCoords(coords) {
      const [lat, lon] = coords; // Яндекс.Карты отдают координаты как [широта, долгота]
      const geocodeParam = `${lon},${lat}`;
      const urlOld = `https://geocode-maps.yandex.ru/1.x/?apikey=${GEOCODER_API_KEY}&geocode=${geocodeParam}&format=json&results=1`;
      const urlNew = `https://geocode-maps.yandex.ru/v1/?apikey=${GEOCODER_API_KEY}&geocode=${geocodeParam}&format=json&results=1`;

      tryGeocode(urlOld)
        .catch(() => tryGeocode(urlNew))
        .then((address) => {
          if (address) document.getElementById('addr-street').value = address;
        })
        .catch((err) => {
          console.error('Не удалось определить адрес по точке на карте (оба варианта запроса не сработали):', err);
        });
    }

    // Проверяем, попадает ли точка в зону доставки, и блокируем сохранение, если нет
    function checkDeliveryZone(coords) {
      markerPicked = true;
      showZone(zoneOf(coords));
    }

    addressMark.events.add('dragend', () => {
      const coords = addressMark.geometry.getCoordinates();
      updateAddressFromCoords(coords);
      checkDeliveryZone(coords);
    });
    deliveryMap.events.add('click', (e) => {
      const coords = e.get('coords');
      addressMark.geometry.setCoordinates(coords);
      updateAddressFromCoords(coords);
      checkDeliveryZone(coords);
    });

    // Клик по кнопке геопозиции — переставляем метку на найденное место
    geoControl.events.add('locationchange', (e) => {
      const coords = e.get('position');
      addressMark.geometry.setCoordinates(coords);
      updateAddressFromCoords(coords);
      checkDeliveryZone(coords);
      deliveryMap.setCenter(coords, 15);
    });
  });
}

// Подсказка под картой: в какой зоне выбранная точка и сколько стоит доставка
function showZone(zone) {
  const warning = document.getElementById('zone-warning');
  const info = document.getElementById('zone-info');
  warning.textContent = 'Ваш адрес не входит в зону доставки';
  warning.hidden = zone !== 'out';
  if (!info) return;
  if (zone === 'near' || zone === 'far') {
    const km = (m) => (m / 1000).toString().replace('.', ',') + '\u00a0км';
    const sub = cartTotal();
    const fee = feeFor(zone, Math.max(sub, 0));
    info.hidden = false;
    info.textContent = zone === 'near'
      ? `Ближняя зона (до ${km(deliveryCfg.nearRadius)}). Доставка: ${sub >= deliveryCfg.freeDeliveryFrom ? 'бесплатно' : money(deliveryCfg.deliveryFee)}.`
      : `Дальняя зона (до ${km(deliveryCfg.farRadius)}). Доставка: ${money(fee)}.`;
  } else {
    info.hidden = true;
  }
}

function openAddressModal() {
  document.getElementById('address-overlay').classList.add('open');
  document.getElementById('address-modal').classList.add('open');
  initDeliveryMap();
  // Карта иногда рисуется криво, если контейнер был скрыт в момент инициализации —
  // на всякий случай пересчитываем размер после появления окна
  setTimeout(() => { if (deliveryMap) deliveryMap.container.fitToViewport(); }, 250);
  updateScrollLock();
}
function closeAddressModal() {
  document.getElementById('address-overlay').classList.remove('open');
  document.getElementById('address-modal').classList.remove('open');
  updateScrollLock();
}
/* Ввели адрес текстом — метка на карте сама переезжает на этот адрес */
let streetTimer = null;
let streetSeq = 0;
function streetHint(text, kind) {
  let h = document.getElementById('addr-hint');
  if (!h) {
    h = document.createElement('div');
    h.id = 'addr-hint';
    h.className = 'product-meta';
    h.style.margin = '-4px 0 8px';
    document.getElementById('addr-street').insertAdjacentElement('afterend', h);
  }
  h.textContent = text || '';
  h.style.color = kind === 'bad' ? '#c0392b' : (kind === 'ok' ? '#2e7d32' : '');
  h.hidden = !text;
}
// Ищем адрес только по Москве и ближайшим окрестностям лавки
function geocodeUrls(text) {
  const q = encodeURIComponent('Москва, ' + text);
  const tail = `geocode=${q}&format=json&results=1&lang=ru_RU&ll=${KITCHEN_COORDS[1]},${KITCHEN_COORDS[0]}&spn=0.5,0.35&rspn=1`;
  return [
    `https://geocode-maps.yandex.ru/1.x/?apikey=${GEOCODER_API_KEY}&${tail}`,
    `https://geocode-maps.yandex.ru/v1/?apikey=${GEOCODER_API_KEY}&${tail}`,
  ];
}
async function forwardGeocode(text) {
  let lastErr = null;
  for (const url of geocodeUrls(text)) {
    try {
      const data = await (await fetch(url)).json();
      const m = data?.response?.GeoObjectCollection?.featureMember?.[0];
      if (!m) { if (data?.response) return null; throw new Error('bad response'); }
      const [lon, lat] = String(m.GeoObject.Point.pos).split(' ').map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('bad point');
      return { coords: [lat, lon], precision: m.GeoObject.metaDataProperty?.GeocoderMetaData?.precision || '' };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('geocode failed');
}
async function moveMapToTypedAddress(tries = 0) {
  const text = document.getElementById('addr-street').value.trim();
  if (text.length < 5) { streetHint(''); return; }
  if (!addressMarkerRef || !deliveryMap) { // карта ещё загружается — попробуем чуть позже
    if (tries < 8) streetTimer = setTimeout(() => moveMapToTypedAddress(tries + 1), 800);
    return;
  }
  const seq = ++streetSeq;
  streetHint('Ищем адрес на карте…');
  try {
    const r = await forwardGeocode(text);
    if (seq !== streetSeq) return; // человек уже ввёл что-то новое
    if (!r) { streetHint('Не нашли такой адрес. Отметьте точку на карте вручную.', 'bad'); return; }
    addressMarkerRef.geometry.setCoordinates(r.coords);
    deliveryMap.setCenter(r.coords, 17, { duration: 500 });
    if (['exact', 'number', 'near'].includes(r.precision)) {
      markerPicked = true;
      showZone(zoneOf(r.coords));
      streetHint('Метка поставлена на ваш адрес. Проверьте её на карте — при необходимости передвиньте.', 'ok');
    } else {
      streetHint('Нашли улицу, но не точный дом. Добавьте номер дома или поставьте метку на карте.', 'bad');
    }
  } catch (e) {
    if (seq === streetSeq) streetHint('Не удалось найти адрес. Отметьте точку на карте вручную.', 'bad');
  }
}
document.getElementById('addr-street').addEventListener('input', () => {
  clearTimeout(streetTimer);
  streetHint('');
  streetTimer = setTimeout(() => moveMapToTypedAddress(0), 800);
});

document.getElementById('open-address-btn').addEventListener('click', openAddressModal);
document.getElementById('address-close').addEventListener('click', closeAddressModal);
document.getElementById('address-overlay').addEventListener('click', closeAddressModal);

document.getElementById('addr-save').addEventListener('click', () => {
  const streetEl = document.getElementById('addr-street');
  const flatEl = document.getElementById('addr-flat');
  const entranceEl = document.getElementById('addr-entrance');
  const intercomEl = document.getElementById('addr-intercom');
  const floorEl = document.getElementById('addr-floor');

  const street = streetEl.value.trim();
  const flat = flatEl.value.trim();
  const entrance = entranceEl.value.trim();
  const intercom = intercomEl.value.trim();
  const floor = floorEl.value.trim();

  // Все поля адреса обязательны, кроме комментария курьеру
  const requiredFields = [streetEl, flatEl, entranceEl, intercomEl, floorEl];
  let firstEmpty = null;
  requiredFields.forEach((el) => {
    const empty = !el.value.trim();
    el.classList.toggle('input-missing', empty);
    if (empty && !firstEmpty) firstEmpty = el;
  });
  if (firstEmpty) {
    firstEmpty.focus();
    return;
  }

  // Точка на карте обязательна: по ней сервер определяет зону и стоимость доставки.
  // Зону проверяем заново по текущему положению метки — не полагаемся на то, что выставлено раньше.
  const warn = document.getElementById('zone-warning');
  if (!addressMarkerRef || typeof ymaps === 'undefined') {
    warn.textContent = 'Карта не загрузилась. Обновите страницу и отметьте адрес на карте';
    warn.hidden = false;
    return;
  }
  if (!markerPicked) {
    warn.textContent = 'Отметьте адрес на карте: нажмите на карту или перетащите метку';
    warn.hidden = false;
    return;
  }
  const pickedCoords = roundCoords(addressMarkerRef.geometry.getCoordinates());
  const pickedZone = zoneOf(pickedCoords);
  if (pickedZone === 'out') {
    showZone('out');
    return;
  }
  deliveryGeo = { lat: pickedCoords[0], lon: pickedCoords[1] };
  deliveryZone = pickedZone;
  warn.hidden = true;

  const parts = [street];
  if (flat) parts.push('кв. ' + flat);
  if (entrance) parts.push('подъезд ' + entrance);
  if (intercom) parts.push('домофон ' + intercom);
  if (floor) parts.push('этаж ' + floor);
  const fullAddress = parts.join(', ');

  document.getElementById('address').value = fullAddress;
  document.getElementById('address-summary').textContent = fullAddress;
  closeAddressModal();
  renderCartWidgets();
});

// Убираем подсветку "не заполнено" как только пользователь начал вводить значение
['addr-street', 'addr-flat', 'addr-entrance', 'addr-intercom', 'addr-floor'].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', () => el.classList.remove('input-missing'));
});

/* ================= ОФОРМЛЕНИЕ ЗАКАЗА ================= */
document.getElementById('checkout-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('form-error');
  errorEl.textContent = '';

  const keys = Object.keys(cart);
  if (keys.length === 0) {
    errorEl.textContent = 'Добавьте хотя бы одно блюдо в корзину';
    return;
  }

  if (cartTotal() < deliveryCfg.minOrder) {
    errorEl.textContent = `Минимальный заказ — ${money(deliveryCfg.minOrder)}`;
    return;
  }

  if (!document.getElementById('address').value.trim() || !deliveryGeo) {
    errorEl.textContent = 'Укажите адрес доставки, отметив точку на карте';
    return;
  }

  const items = keys.map((key) => {
    const line = cart[key];
    const payload = { id: line.productId, qty: line.qty };
    if (line.type === 'variant') payload.variantId = line.variantId;
    if (line.type === 'combo') payload.comboSelections = line.comboSelections;
    return payload;
  });

  const courierComment = document.getElementById('addr-comment').value.trim();
  const orderComment = document.getElementById('comment').value.trim();

  const customer = {
    name: document.getElementById('name').value.trim(),
    phone: document.getElementById('phone').value.trim(),
    address: document.getElementById('address').value.trim(),
    comment: [orderComment, courierComment ? 'Курьеру: ' + courierComment : ''].filter(Boolean).join(' / '),
  };

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, customer, geo: deliveryGeo, cutleryCount, consentPd: document.getElementById('agree-pd').checked }),
    });
    const data = await res.json();

    if (!res.ok) {
      errorEl.textContent = data.error || 'Не удалось оформить заказ';
      return;
    }

    // Цель «нажал оплатить»: даём Метрике долю секунды отправить событие перед переходом на оплату
    let went = false;
    const goPay = () => { if (!went) { went = true; window.location.href = data.confirmationUrl; } };
    if (window.__goal) window.__goal('order_submit', { order_price: data.total || cartTotal() });
    setTimeout(goPay, 400);
  } catch (err) {
    errorEl.textContent = 'Ошибка сети, попробуйте ещё раз';
  }
});

/* ================= Часы работы ================= */
function checkWorkingHours() {
  const hour = new Date().getHours();
  const banner = document.getElementById('hours-banner');
  if (hour < 10 || hour >= 22) {
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}
checkWorkingHours();

/* ================= Меню категорий появляется при прокрутке ================= */
function setupNavAppearOnScroll() {
  const row = document.getElementById('category-nav-row');
  function update() {
    if (window.scrollY > 80) {
      row.classList.add('visible');
    } else {
      row.classList.remove('visible');
    }
  }
  window.addEventListener('scroll', update, { passive: true });
  update();
}
setupNavAppearOnScroll();

/* ================= Оферта и политика: открываются поверх страницы ================= */
function openLegal(url) {
  document.getElementById('legal-frame').src = url;
  document.getElementById('legal-overlay').classList.add('open');
  document.getElementById('legal-modal').classList.add('open');
  updateScrollLock();
}
function closeLegal() {
  document.getElementById('legal-overlay').classList.remove('open');
  document.getElementById('legal-modal').classList.remove('open');
  updateScrollLock();
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="/legal/"]');
  if (!a) return;
  e.preventDefault();
  openLegal(a.getAttribute('href'));
});
document.getElementById('legal-close').addEventListener('click', closeLegal);
document.getElementById('legal-overlay').addEventListener('click', closeLegal);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLegal(); });

/* ================= Плашка про cookies ================= */
(function () {
  const METRIKA_ID = 114152765;
  const KEY = 'cookie_consent_v2'; // '1' — аналитика разрешена, '0' — только необходимые
  const banner = document.getElementById('cookie-banner');
  const main = document.getElementById('cookie-main');
  const panel = document.getElementById('cookie-panel');
  const chk = document.getElementById('cookie-analytics');

  // Цели Метрики (работают только если человек разрешил аналитику; иначе тихо ничего не делают)
  window.__goal = function (name, params) {
    try { if (window.ym && getChoice() === '1') window.ym(METRIKA_ID, 'reachGoal', name, params); } catch (e) {}
  };

  // Яндекс Метрика запускается только с согласия. Вебвизор и карта кликов выключены.
  function loadMetrika() {
    window['disableYaCounter' + METRIKA_ID] = false;
    if (window.__ymLoaded) return;
    window.__ymLoaded = true;
    (function (m, e, t, r, i, k, a) {
      m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
      m[i].l = 1 * new Date();
      k = e.createElement(t); a = e.getElementsByTagName(t)[0];
      k.async = 1; k.src = r; a.parentNode.insertBefore(k, a);
    })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js?id=' + METRIKA_ID, 'ym');
    window.ym(METRIKA_ID, 'init', {
      webvisor: false, clickmap: false, trackLinks: true, accurateTrackBounce: true
    });
  }

  // Если аналитику отключили: останавливаем счётчик и удаляем его cookie
  function stopMetrika() {
    window['disableYaCounter' + METRIKA_ID] = true;
    document.cookie.split(';').forEach((c) => {
      const name = c.split('=')[0].trim();
      if (!/^_ym/.test(name)) return;
      ['', '; domain=' + location.hostname, '; domain=.' + location.hostname].forEach((d) => {
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + d;
      });
    });
  }

  function getChoice() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function save(analytics) {
    try { localStorage.setItem(KEY, analytics ? '1' : '0'); } catch (e) {}
    banner.hidden = true;
    if (analytics) loadMetrika(); else stopMetrika();
  }
  function showMain() { panel.hidden = true; main.hidden = false; banner.hidden = false; }
  function showSettings() {
    chk.checked = getChoice() === '1';
    main.hidden = true; panel.hidden = false; banner.hidden = false;
  }

  const choice = getChoice();
  if (choice === '1') loadMetrika();
  if (choice === null) showMain();

  document.getElementById('cookie-accept').addEventListener('click', () => save(true));
  document.getElementById('cookie-decline').addEventListener('click', () => save(false));
  document.getElementById('cookie-necessary').addEventListener('click', () => save(false));
  document.getElementById('cookie-save').addEventListener('click', () => save(chk.checked));
  document.getElementById('cookie-settings').addEventListener('click', showSettings);
  // Ссылка «Настройки cookie» внизу сайта: изменить выбор можно в любой момент
  document.getElementById('cookie-open').addEventListener('click', (e) => { e.preventDefault(); showSettings(); });
})();

/* ================= Слайды с акциями (картинки из slides.json) ================= */
(async function loadSlides() {
  const box = document.getElementById('promo-slider');
  if (!box) return;
  let slides = [];
  try { slides = await (await fetch('slides.json', { cache: 'no-cache' })).json(); } catch (e) {}
  slides = (Array.isArray(slides) ? slides : []).filter((x) => x && x.image);
  if (!slides.length) return; // картинок нет — блок не показываем

  const track = document.getElementById('promo-track');
  track.innerHTML = slides.map((x) => {
    const img = `<img src="${x.image}" alt="${(x.alt || 'Акция').replace(/"/g, '')}" loading="lazy" draggable="false" />`;
    return x.link ? `<a class="promo-slide" href="${x.link}">${img}</a>` : `<div class="promo-slide">${img}</div>`;
  }).join('');
  box.hidden = false;

  // Стрелка «вперёд» для компьютера, если картинки не помещаются
  const arrow = document.createElement('button');
  arrow.type = 'button';
  arrow.className = 'promo-arrow';
  arrow.setAttribute('aria-label', 'Дальше');
  arrow.textContent = '›';
  box.appendChild(arrow);
  const update = () => {
    const more = track.scrollWidth - track.clientWidth - track.scrollLeft > 4;
    arrow.classList.toggle('show', more);
  };
  arrow.addEventListener('click', () => {
    const atEnd = track.scrollWidth - track.clientWidth - track.scrollLeft <= 4;
    track.scrollBy({ left: atEnd ? -track.scrollWidth : 290, behavior: 'smooth' });
  });
  track.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  window.addEventListener('load', update);
  update();
})();

loadProducts();

/* ================= ОТКЛИК, ВЫСОТА ШАПКИ, СВАЙП ШТОРКИ ================= */

// Чтобы на iPhone срабатывал :active (кнопка сжимается сразу при касании)
document.addEventListener('touchstart', function () {}, { passive: true });

// Лёгкая вибрация "клика" на основных кнопках (там, где телефон это поддерживает; iPhone — нет)
document.addEventListener('pointerdown', function (e) {
  if (!navigator.vibrate) return;
  const b = e.target.closest && e.target.closest('.add-btn, .buy-btn, .checkout-btn, .qty-stepper button, .choice-stepper button, .choice-box');
  if (b && !b.disabled) navigator.vibrate(8);
}, { passive: true });

// Высота шапки → в CSS, чтобы строка категорий всегда ровно под шапкой, без щели и перекрытия
(function () {
  const header = document.querySelector('.site-header');
  if (!header) return;
  function setHeaderHeight() {
    document.documentElement.style.setProperty('--header-h', header.offsetHeight + 'px');
  }
  setHeaderHeight();
  window.addEventListener('resize', setHeaderHeight);
  window.addEventListener('load', setHeaderHeight);
  if (window.ResizeObserver) new ResizeObserver(setHeaderHeight).observe(header);
})();

// Смахнуть карточку блюда вниз, как шторку на iPhone. Работает ТОЛЬКО за фото
// (описание и кнопки внизу не реагируют на свайп) и только на телефоне.
(function () {
  const modal = document.getElementById('picker-modal');
  const overlay = document.getElementById('picker-overlay');
  if (!modal || !overlay) return;
  let tracking = false, dragging = false, startX = 0, startY = 0, startT = 0, dy = 0;

  const isPhone = () => window.matchMedia('(max-width: 640px)').matches;

  function reset() {
    modal.style.transform = '';
    overlay.style.opacity = '';
    modal.classList.remove('dragging');
  }

  modal.addEventListener('touchstart', function (e) {
    if (!isPhone() || !modal.classList.contains('open') || e.touches.length !== 1) return;
    if (!e.target.closest('.picker-photo')) return;           // только зона фото
    const scroller = modal.querySelector('.picker-scroll');
    if (scroller && scroller.scrollTop > 0) return;            // содержимое прокручено — не мешаем
    tracking = true; dragging = false; dy = 0;
    startX = e.touches[0].clientX; startY = e.touches[0].clientY; startT = Date.now();
  }, { passive: true });

  modal.addEventListener('touchmove', function (e) {
    if (!tracking) return;
    const t = e.touches[0];
    const mx = t.clientX - startX, my = t.clientY - startY;
    if (!dragging) {
      if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;        // ещё не понятно, куда
      if (my > 0 && my > Math.abs(mx)) { dragging = true; modal.classList.add('dragging'); }
      else { tracking = false; return; }                        // вверх или вбок — это не закрытие
    }
    dy = Math.max(0, my);
    modal.style.transform = 'translateY(' + dy + 'px)';
    overlay.style.opacity = String(Math.max(0, 1 - dy / 450));
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  function finish() {
    if (!tracking) return;
    const wasDragging = dragging;
    tracking = false; dragging = false;
    if (!wasDragging) return;
    const speed = dy / Math.max(1, Date.now() - startT);        // пикселей в миллисекунду
    const close = dy > 110 || (speed > 0.4 && dy > 30);
    reset();                                                     // анимацию дальше ведёт CSS
    if (close) closePicker();
  }
  modal.addEventListener('touchend', finish);
  modal.addEventListener('touchcancel', finish);
})();
