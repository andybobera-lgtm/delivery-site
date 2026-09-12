let products = [];
// Корзина теперь — объект { lineKey: lineData }, а не просто { productId: qty },
// потому что один и тот же товар может быть добавлен с разными вариантами
// (например, хинкал с говядиной и хинкал с колбасой — это две разные строки).
let cart = {};

const THUMB_COLORS = ['#b5432a', '#c98a3d', '#7a8f5c', '#5c7a8f', '#8f5c7a'];

function colorFor(id) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) % THUMB_COLORS.length;
  return THUMB_COLORS[hash];
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
  categories.forEach((cat) => {
    const a = document.createElement('a');
    a.className = 'category-chip';
    a.href = '#cat-' + slug(cat);
    a.textContent = cat;
    nav.appendChild(a);
  });
}

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

function renderProductCard(p) {
  const card = document.createElement('div');
  card.className = 'product-card';
  card.dataset.id = p.id;

  const thumb = document.createElement('div');
  thumb.className = 'product-thumb';
  thumb.style.background = colorFor(p.id);
  thumb.textContent = (p.name || '?').trim()[0] || '?';

  const priceHtml = renderPriceBlock(p);

  const body = document.createElement('div');
  body.className = 'product-body';
  body.innerHTML = `
    <h3>${p.name}</h3>
    <p>${p.description || ''}</p>
    <div class="product-meta">${p.weight || ''}</div>
    <div class="product-footer">
      <span class="product-price">${priceHtml}</span>
      <div class="card-action"></div>
    </div>
  `;

  card.appendChild(thumb);
  card.appendChild(body);

  renderCardAction(card, p);
  return card;
}

function renderPriceBlock(p) {
  if (p.type === 'combo') {
    const old = p.oldPrice ? `<span class="old-price">${p.oldPrice} ₽</span>` : '';
    return `${old}${p.price} ₽`;
  }
  if (typeof p.price !== 'number') {
    return `<span class="no-price-note">уточняйте</span>`;
  }
  return `${p.price} ₽`;
}

/* ---------- Действие на карточке (кнопка/счётчик) ---------- */
function renderCardAction(card, product) {
  const slot = card.querySelector('.card-action');

  if (typeof product.price !== 'number' && product.type !== 'combo') {
    slot.innerHTML = '';
    return;
  }

  if (product.type === 'combo') {
    slot.innerHTML = `<button class="add-btn" title="Собрать набор">+</button>`;
    slot.querySelector('.add-btn').addEventListener('click', () => openComboPicker(product));
    return;
  }

  if (product.type === 'variant') {
    const totalQty = totalQtyForProduct(product.id);
    if (totalQty === 0) {
      slot.innerHTML = `<button class="add-btn" title="Выбрать">+</button>`;
      slot.querySelector('.add-btn').addEventListener('click', () => openVariantPicker(product));
    } else {
      slot.innerHTML = `<div class="qty-stepper" title="Изменить в корзине"><span>${totalQty}</span></div>`;
      slot.querySelector('.qty-stepper').addEventListener('click', () => openVariantPicker(product));
    }
    return;
  }

  const key = product.id;
  const qty = cart[key] ? cart[key].qty : 0;

  if (qty === 0) {
    slot.innerHTML = `<button class="add-btn">+</button>`;
    slot.querySelector('.add-btn').addEventListener('click', () => {
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

/* ---------- Обычные товары ---------- */
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

/* ---------- Товары с вариантами (хинкал) ---------- */
function openVariantPicker(product) {
  const overlay = document.getElementById('picker-overlay');
  const modal = document.getElementById('picker-modal');

  const optionsHtml = product.variants.map((v) => {
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
          <div class="qty-stepper" style="background:${qty > 0 ? 'var(--accent)' : 'var(--bg)'};">
            <button data-action="minus" style="color:${qty > 0 ? 'white' : 'var(--accent)'}">−</button>
            <span style="color:${qty > 0 ? 'white' : 'var(--ink)'}">${qty}</span>
            <button data-action="plus" style="color:${qty > 0 ? 'white' : 'var(--accent)'}">+</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  modal.innerHTML = `
    <div class="picker-header">
      <h3>${product.name}</h3>
      <button class="cart-close" id="picker-close">✕</button>
    </div>
    <div class="picker-body">${optionsHtml}</div>
    <div class="picker-footer">
      <button class="checkout-btn" id="picker-done">Готово</button>
    </div>
  `;

  modal.querySelectorAll('.variant-option').forEach((row) => {
    const variantId = row.dataset.variantId;
    const variant = product.variants.find((v) => v.id === variantId);
    const key = product.id + '::' + variantId;

    row.querySelector('[data-action="plus"]').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!cart[key]) {
        cart[key] = { productId: product.id, type: 'variant', variantId, name: product.name + ' (' + variant.label + ')', price: variant.price, qty: 0 };
      }
      cart[key].qty += 1;
      renderCartWidgets();
      openVariantPicker(product);
    });
    row.querySelector('[data-action="minus"]').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!cart[key]) return;
      cart[key].qty -= 1;
      if (cart[key].qty <= 0) delete cart[key];
      renderCartWidgets();
      openVariantPicker(product);
    });
  });

  document.getElementById('picker-close').addEventListener('click', closePicker);
  document.getElementById('picker-done').addEventListener('click', closePicker);

  overlay.hidden = false;
  modal.hidden = false;
  overlay.onclick = closePicker;
}

function closePicker() {
  document.getElementById('picker-overlay').hidden = true;
  document.getElementById('picker-modal').hidden = true;
  refreshAllCards();
}

/* ---------- Наборы (чуду) ---------- */
function openComboPicker(product) {
  const selection = {};
  product.options.forEach((o) => { selection[o.id] = 0; });

  function totalCount() {
    return Object.values(selection).reduce((a, b) => a + b, 0);
  }
  function meatCount() {
    return product.options.filter((o) => o.isMeat).reduce((sum, o) => sum + selection[o.id], 0);
  }

  function render() {
    const overlay = document.getElementById('picker-overlay');
    const modal = document.getElementById('picker-modal');

    const rows = product.options.map((o) => {
      const count = selection[o.id];
      const atMeatLimit = o.isMeat && meatCount() >= product.meatMax;
      const atTotalLimit = totalCount() >= product.totalSlots;
      const plusDisabled = atTotalLimit || atMeatLimit;
      return `
        <div class="combo-option-row">
          <span class="combo-option-name">${o.name} ${o.isMeat ? '<span class="combo-option-tag">С МЯСОМ</span>' : ''}</span>
          <div class="qty-stepper" style="background:${count > 0 ? 'var(--accent)' : 'var(--bg)'};">
            <button data-opt="${o.id}" data-action="minus" style="color:${count > 0 ? 'white' : 'var(--accent)'}">−</button>
            <span style="color:${count > 0 ? 'white' : 'var(--ink)'}">${count}</span>
            <button data-opt="${o.id}" data-action="plus" ${plusDisabled ? 'disabled style="opacity:0.3"' : 'style="color:var(--accent)"'}>+</button>
          </div>
        </div>
      `;
    }).join('');

    modal.innerHTML = `
      <div class="picker-header">
        <h3>${product.name}</h3>
        <button class="cart-close" id="picker-close">✕</button>
      </div>
      <div class="picker-body">
        <div class="combo-progress">
          Выбрано: <b>${totalCount()} / ${product.totalSlots}</b> · с мясом: <b>${meatCount()} / ${product.meatMax}</b>
        </div>
        ${rows}
      </div>
      <div class="picker-footer">
        <button class="checkout-btn" id="picker-done" ${totalCount() === product.totalSlots ? '' : 'disabled style="opacity:0.5"'}>
          Добавить в корзину — ${product.price} ₽
        </button>
      </div>
    `;

    modal.querySelectorAll('[data-action="plus"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.opt;
        const opt = product.options.find((o) => o.id === id);
        if (totalCount() >= product.totalSlots) return;
        if (opt.isMeat && meatCount() >= product.meatMax) return;
        selection[id] += 1;
        render();
      });
    });
    modal.querySelectorAll('[data-action="minus"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.opt;
        if (selection[id] > 0) selection[id] -= 1;
        render();
      });
    });

    document.getElementById('picker-close').addEventListener('click', closePicker);

    const doneBtn = document.getElementById('picker-done');
    if (totalCount() === product.totalSlots) {
      doneBtn.addEventListener('click', () => {
        const comboSelections = product.options
          .filter((o) => selection[o.id] > 0)
          .map((o) => ({ name: o.name, count: selection[o.id] }));
        const key = product.id + '::' + Date.now();
        cart[key] = {
          productId: product.id,
          type: 'combo',
          name: product.name,
          price: product.price,
          qty: 1,
          comboSelections,
        };
        renderCartWidgets();
        closePicker();
      });
    }

    overlay.hidden = false;
    modal.hidden = false;
    overlay.onclick = closePicker;
  }

  render();
}

function refreshAllCards() {
  document.querySelectorAll('.product-card').forEach((card) => {
    const product = products.find((p) => p.id === card.dataset.id);
    if (product) renderCardAction(card, product);
  });
}

/* ---------- Итоги корзины ---------- */
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

  renderCartDrawerItems();
  refreshAllCards();
}

function renderCartDrawerItems() {
  const container = document.getElementById('cart-items');
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

/* ---------- Открытие/закрытие корзины ---------- */
function openCart() {
  document.getElementById('cart-drawer').classList.add('open');
  document.getElementById('cart-overlay').hidden = false;
}
function closeCart() {
  document.getElementById('cart-drawer').classList.remove('open');
  document.getElementById('cart-overlay').hidden = true;
}

document.getElementById('cart-fab').addEventListener('click', openCart);
document.getElementById('cart-close').addEventListener('click', closeCart);
document.getElementById('cart-overlay').addEventListener('click', closeCart);

/* ---------- Оформление заказа ---------- */
document.getElementById('checkout-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('form-error');
  errorEl.textContent = '';

  const keys = Object.keys(cart);
  if (keys.length === 0) {
    errorEl.textContent = 'Добавьте хотя бы одно блюдо в корзину';
    return;
  }

  const items = keys.map((key) => {
    const line = cart[key];
    const payload = { id: line.productId, qty: line.qty };
    if (line.type === 'variant') payload.variantId = line.variantId;
    if (line.type === 'combo') payload.comboSelections = line.comboSelections;
    return payload;
  });

  const customer = {
    name: document.getElementById('name').value.trim(),
    phone: document.getElementById('phone').value.trim(),
    address: document.getElementById('address').value.trim(),
    comment: document.getElementById('comment').value.trim(),
  };

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, customer }),
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
