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

async function loadProducts() {
  const res = await fetch('/api/products');
  products = await res.json();
  renderCategoryNav();
  renderMenu();
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
    a.addEventListener('click', () => setActiveCategoryChip(slug(cat)));
    nav.appendChild(a);
  });

  const mobileList = document.getElementById('mobile-menu-list');
  mobileList.innerHTML = '';
  categories.forEach((cat) => {
    const a = document.createElement('a');
    a.href = '#cat-' + slug(cat);
    a.textContent = cat;
    a.addEventListener('click', () => {
      setActiveCategoryChip(slug(cat));
      closeMobileMenu();
    });
    mobileList.appendChild(a);
  });

  setupCategoryScrollSpy();
}

function setActiveCategoryChip(catSlug) {
  document.querySelectorAll('.category-chip').forEach((chip) => {
    const isActive = chip.getAttribute('href') === '#cat-' + catSlug;
    chip.classList.toggle('active', isActive);
    if (isActive) chip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  });
}

// Подсвечиваем категорию автоматически, когда её раздел появляется в зоне видимости при прокрутке
function setupCategoryScrollSpy() {
  const sections = document.querySelectorAll('.menu-section');
  if (!sections.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setActiveCategoryChip(entry.target.id.replace('cat-', ''));
        }
      });
    },
    { rootMargin: '-140px 0px -70% 0px', threshold: 0 }
  );

  sections.forEach((section) => observer.observe(section));
}

function openMobileMenu() {
  document.getElementById('mobile-menu-drawer').classList.add('open');
  document.getElementById('mobile-menu-overlay').classList.add('open');
}
function closeMobileMenu() {
  document.getElementById('mobile-menu-drawer').classList.remove('open');
  document.getElementById('mobile-menu-overlay').classList.remove('open');
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
  const categories = [...new Set(products.map((p) => p.category || 'Меню'))];

  categories.forEach((cat) => {
    const section = document.createElement('section');
    section.className = 'menu-section';
    section.id = 'cat-' + slug(cat);

    const heading = document.createElement('h2');
    heading.textContent = cat;
    section.appendChild(heading);

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
    <h3>${p.name}</h3>
    <div class="product-meta">${p.weight || ''}</div>
    <div class="product-footer">
      <div class="card-action"></div>
    </div>
  `;

  card.appendChild(thumb);
  card.appendChild(body);

  card.addEventListener('click', (e) => {
    if (e.target.closest('.card-action')) return;
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
    slot.innerHTML = `<button class="buy-btn">${old}${product.price} ₽ <span>+</span></button>`;
    slot.querySelector('.buy-btn').addEventListener('click', () => openComboPicker(product));
    return;
  }

  if (product.type === 'variant') {
    const totalQty = totalQtyForProduct(product.id);
    if (totalQty === 0) {
      slot.innerHTML = `<button class="buy-btn">${product.price} ₽ <span>+</span></button>`;
      slot.querySelector('.buy-btn').addEventListener('click', () => openVariantPicker(product));
    } else {
      slot.innerHTML = `<div class="qty-stepper" title="Изменить в корзине"><span>${totalQty}</span></div>`;
      slot.querySelector('.qty-stepper').addEventListener('click', () => openVariantPicker(product));
    }
    return;
  }

  const key = product.id;
  const qty = cart[key] ? cart[key].qty : 0;

  if (qty === 0) {
    slot.innerHTML = `<button class="buy-btn">${product.price} ₽ <span>+</span></button>`;
    slot.querySelector('.buy-btn').addEventListener('click', () => {
      addSimpleToCart(product);
      renderCardAction(card, product);
    });
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
function showPicker() {
  document.getElementById('picker-overlay').classList.add('open');
  document.getElementById('picker-modal').classList.add('open');
}
function closePicker() {
  document.getElementById('picker-overlay').classList.remove('open');
  document.getElementById('picker-modal').classList.remove('open');
  refreshAllCards();
}
document.getElementById('picker-overlay').addEventListener('click', closePicker);

function pickerShell(product, bodyHtml, footerHtml) {
  const modal = document.getElementById('picker-modal');
  const thumbData = thumbStyleAndText(product);
  modal.innerHTML = `
    <div class="picker-photo" style="${thumbData.style}">${thumbData.text}</div>
    <div class="picker-panel">
      <div class="picker-header">
        <h3>${product.name}</h3>
        <button class="cart-close" id="picker-close">✕</button>
      </div>
      <div class="picker-body">${bodyHtml}</div>
      <div class="picker-footer">${footerHtml}</div>
    </div>
  `;
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
    `;
    const footer = noPrice
      ? `<div class="no-price-note">Цену уточняйте при оформлении заказа</div>`
      : qty === 0
        ? `<button class="checkout-btn" id="detail-add">Добавить — ${product.price} ₽</button>`
        : `<div style="display:flex;align-items:center;justify-content:space-between;">
             <div class="qty-stepper" style="background:var(--accent);">
               <button id="detail-minus" style="color:white;">−</button>
               <span style="color:white;">${qty}</span>
               <button id="detail-plus" style="color:white;">+</button>
             </div>
             <span style="font-weight:700;color:var(--accent);">${product.price * qty} ₽</span>
           </div>`;

    pickerShell(product, body, footer);

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
          <div style="display:flex;align-items:center;gap:10px;">
            <span class="variant-option-price">${v.price} ₽</span>
            <div class="qty-stepper" style="background:${qty > 0 ? 'var(--accent)' : 'var(--soft-bg)'};">
              <button data-action="minus" style="color:${qty > 0 ? 'white' : 'var(--accent)'}">−</button>
              <span style="color:${qty > 0 ? 'white' : 'var(--ink)'}">${qty}</span>
              <button data-action="plus" style="color:${qty > 0 ? 'white' : 'var(--accent)'}">+</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    const body = (product.description ? `<div class="picker-description">${product.description}</div>` : '') + rows;
    pickerShell(product, body, `<button class="checkout-btn" id="picker-done">Готово</button>`);

    document.querySelectorAll('.variant-option').forEach((row) => {
      const variantId = row.dataset.variantId;
      const variant = product.variants.find((v) => v.id === variantId);
      const key = product.id + '::' + variantId;

      row.querySelector('[data-action="plus"]').addEventListener('click', (e) => {
        e.stopPropagation();
        if (!cart[key]) cart[key] = { productId: product.id, type: 'variant', variantId, name: product.name + ' (' + variant.label + ')', price: variant.price, qty: 0 };
        cart[key].qty += 1;
        renderCartWidgets();
        render();
      });
      row.querySelector('[data-action="minus"]').addEventListener('click', (e) => {
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
        <div class="combo-option-row">
          <span class="combo-option-name">${o.name}</span>
          <div class="qty-stepper" style="background:${count > 0 ? 'var(--accent)' : 'var(--soft-bg)'};">
            <button data-opt="${o.id}" data-action="minus" style="color:${count > 0 ? 'white' : 'var(--accent)'}">−</button>
            <span style="color:${count > 0 ? 'white' : 'var(--ink)'}">${count}</span>
            <button data-opt="${o.id}" data-action="plus" ${plusDisabled ? 'disabled style="opacity:0.3"' : `style="color:${count > 0 ? 'white' : 'var(--accent)'}"`}>+</button>
          </div>
        </div>
      `;
    }).join('');

    const body = `
      ${product.description ? `<div class="picker-description">${product.description}</div>` : ''}
      <div class="combo-progress">Выбрано: <b>${totalCount()} / ${product.totalSlots}</b></div>
      ${rows}
    `;
    const footer = `
      <button class="checkout-btn" id="picker-done" ${totalCount() === product.totalSlots ? '' : 'disabled style="opacity:0.5"'}>
        Добавить в корзину — ${product.price} ₽
      </button>
    `;
    pickerShell(product, body, footer);

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

    if (totalCount() === product.totalSlots) {
      document.getElementById('picker-done').addEventListener('click', () => {
        const comboSelections = product.options.filter((o) => selection[o.id] > 0).map((o) => ({ name: o.name, count: selection[o.id] }));
        const key = product.id + '::' + Date.now();
        cart[key] = { productId: product.id, type: 'combo', name: product.name, price: product.price, qty: 1, comboSelections };
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

function renderCartWidgets() {
  const fab = document.getElementById('cart-fab');
  const count = cartCount();

  if (count === 0) {
    fab.hidden = true;
  } else {
    fab.hidden = false;
    document.getElementById('cart-fab-count').textContent = count;
    document.getElementById('cart-fab-total').textContent = cartTotal() + ' ₽';
  }

  renderCartLines();
  renderUpsell();
  refreshAllCards();
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
    const row = document.createElement('div');
    row.className = 'cart-line';

    if (line.type === 'combo') {
      const extra = line.comboSelections
        ? `<div class="product-meta">${line.comboSelections.map((s) => s.name + ' ×' + s.count).join(', ')}</div>`
        : '';
      row.innerHTML = `
        <div style="flex-grow:1;">
          <span class="cart-line-name">${line.name}</span>
          ${extra}
        </div>
        <span class="cart-line-price">${line.price} ₽</span>
        <a href="#" data-remove="${key}" style="color:var(--muted);">✕</a>
      `;
      row.querySelector('[data-remove]').addEventListener('click', (e) => {
        e.preventDefault();
        delete cart[key];
        renderCartWidgets();
      });
    } else {
      row.innerHTML = `
        <span class="cart-line-name">${line.name}</span>
        <div class="qty-stepper">
          <button data-action="minus">−</button>
          <span>${line.qty}</span>
          <button data-action="plus">+</button>
        </div>
        <span class="cart-line-price">${line.price * line.qty} ₽</span>
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
    <div class="cart-upsell-row" id="cart-upsell-row"></div>
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
}

/* ================= ПРИБОРЫ ================= */
function renderCutlery() {
  document.getElementById('cutlery-count').textContent = cutleryCount;
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
}
function closeCart() {
  document.getElementById('cart-drawer').classList.remove('open');
  document.getElementById('cart-overlay').classList.remove('open');
}
document.getElementById('cart-fab').addEventListener('click', openCart);
document.getElementById('cart-close').addEventListener('click', closeCart);
document.getElementById('cart-overlay').addEventListener('click', closeCart);

/* ================= АДРЕС ДОСТАВКИ ================= */
const KITCHEN_COORDS = [55.673030, 37.614196]; // Кулинарная лавка «Дачная беседка»
const DELIVERY_RADIUS_M = 4000;
let deliveryMap = null;

function initDeliveryMap() {
  if (deliveryMap || typeof ymaps === 'undefined') return;
  ymaps.ready(() => {
    deliveryMap = new ymaps.Map('delivery-map', {
      center: KITCHEN_COORDS,
      zoom: 12,
      controls: [],
    }, {
      suppressMapOpenBlock: true, // убираем нижнюю плашку-ссылку "Открыть в Яндекс Картах"
    });

    // Аккуратные контролы масштаба и геопозиции
    const zoomControl = new ymaps.control.ZoomControl({ options: { size: 'large', float: 'right' } });
    const geoControl = new ymaps.control.GeolocationControl({ options: { float: 'right' } });
    deliveryMap.controls.add(zoomControl);
    deliveryMap.controls.add(geoControl);

    deliveryMap.geoObjects.add(new ymaps.Circle([KITCHEN_COORDS, DELIVERY_RADIUS_M], {}, {
      fillColor: '#f15a2422',
      strokeColor: '#f15a24',
      strokeWidth: 2,
    }));

    // Метка адреса — её можно перетаскивать, а клик по карте переставляет её на новое место
    const addressMark = new ymaps.Placemark(KITCHEN_COORDS, {}, {
      preset: 'islands#redDotIcon',
      draggable: true,
    });
    deliveryMap.geoObjects.add(addressMark);

    function updateAddressFromCoords(coords) {
      ymaps.geocode(coords).then((res) => {
        const nearest = res.geoObjects.get(0);
        if (nearest) {
          document.getElementById('addr-street').value = nearest.getAddressLine();
        }
      }).catch((err) => {
        console.error('Не удалось определить адрес по точке на карте:', err);
      });
    }

    addressMark.events.add('dragend', () => updateAddressFromCoords(addressMark.geometry.getCoordinates()));
    deliveryMap.events.add('click', (e) => {
      const coords = e.get('coords');
      addressMark.geometry.setCoordinates(coords);
      updateAddressFromCoords(coords);
    });

    // Клик по кнопке геопозиции — переставляем метку на найденное место
    geoControl.events.add('locationchange', (e) => {
      const coords = e.get('position');
      addressMark.geometry.setCoordinates(coords);
      updateAddressFromCoords(coords);
      deliveryMap.setCenter(coords, 15);
    });
  });
}

function openAddressModal() {
  document.getElementById('address-overlay').classList.add('open');
  document.getElementById('address-modal').classList.add('open');
  initDeliveryMap();
  // Карта иногда рисуется криво, если контейнер был скрыт в момент инициализации —
  // на всякий случай пересчитываем размер после появления окна
  setTimeout(() => { if (deliveryMap) deliveryMap.container.fitToViewport(); }, 250);
}
function closeAddressModal() {
  document.getElementById('address-overlay').classList.remove('open');
  document.getElementById('address-modal').classList.remove('open');
}
document.getElementById('open-address-btn').addEventListener('click', openAddressModal);
document.getElementById('address-close').addEventListener('click', closeAddressModal);
document.getElementById('address-overlay').addEventListener('click', closeAddressModal);

document.getElementById('addr-save').addEventListener('click', () => {
  const street = document.getElementById('addr-street').value.trim();
  const flat = document.getElementById('addr-flat').value.trim();
  const entrance = document.getElementById('addr-entrance').value.trim();
  const intercom = document.getElementById('addr-intercom').value.trim();
  const floor = document.getElementById('addr-floor').value.trim();

  if (!street) {
    document.getElementById('addr-street').focus();
    return;
  }

  const parts = [street];
  if (flat) parts.push('кв. ' + flat);
  if (entrance) parts.push('подъезд ' + entrance);
  if (intercom) parts.push('домофон ' + intercom);
  if (floor) parts.push('этаж ' + floor);
  const fullAddress = parts.join(', ');

  document.getElementById('address').value = fullAddress;
  document.getElementById('address-summary').textContent = fullAddress;
  closeAddressModal();
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

  if (!document.getElementById('address').value.trim()) {
    errorEl.textContent = 'Укажите адрес доставки';
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
      body: JSON.stringify({ items, customer, cutleryCount }),
    });
    const data = await res.json();

    if (!res.ok) {
      errorEl.textContent = data.error || 'Не удалось оформить заказ';
      return;
    }

    window.location.href = data.confirmationUrl;
  } catch (err) {
    errorEl.textContent = 'Ошибка сети, попробуйте ещё раз';
  }
});

loadProducts();
