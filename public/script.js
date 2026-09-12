let products = [];
let cart = {}; // { productId: qty }

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
  thumb.textContent = p.name.trim()[0] || '?';

  const body = document.createElement('div');
  body.className = 'product-body';
  body.innerHTML = `
    <h3>${p.name}</h3>
    <p>${p.description || ''}</p>
    <div class="product-meta">${p.weight || ''}</div>
    <div class="product-footer">
      <span class="product-price">${p.price} ₽</span>
      <div class="card-action"></div>
    </div>
  `;

  card.appendChild(thumb);
  card.appendChild(body);

  renderCardAction(card, p.id);
  return card;
}

function renderCardAction(card, id) {
  const slot = card.querySelector('.card-action');
  const qty = cart[id] || 0;

  if (qty === 0) {
    slot.innerHTML = `<button class="add-btn">+</button>`;
    slot.querySelector('.add-btn').addEventListener('click', () => {
      addToCart(id);
      renderCardAction(card, id);
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
      decreaseQty(id);
      renderCardAction(card, id);
    });
    slot.querySelector('[data-action="plus"]').addEventListener('click', () => {
      addToCart(id);
      renderCardAction(card, id);
    });
  }
}

function addToCart(id) {
  cart[id] = (cart[id] || 0) + 1;
  renderCartWidgets();
}

function decreaseQty(id) {
  if (!cart[id]) return;
  cart[id] -= 1;
  if (cart[id] <= 0) delete cart[id];
  renderCartWidgets();
}

function cartTotal() {
  return Object.entries(cart).reduce((sum, [id, qty]) => {
    const product = products.find((p) => p.id === id);
    return product ? sum + product.price * qty : sum;
  }, 0);
}

function cartCount() {
  return Object.values(cart).reduce((a, b) => a + b, 0);
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
}

function renderCartDrawerItems() {
  const container = document.getElementById('cart-items');
  const totalEl = document.getElementById('cart-total');
  const ids = Object.keys(cart);

  if (ids.length === 0) {
    container.innerHTML = 'Корзина пуста';
    totalEl.textContent = '0 ₽';
    return;
  }

  container.innerHTML = '';
  ids.forEach((id) => {
    const product = products.find((p) => p.id === id);
    if (!product) return;
    const qty = cart[id];
    const line = document.createElement('div');
    line.className = 'cart-line';
    line.innerHTML = `
      <span class="cart-line-name">${product.name}</span>
      <div class="qty-stepper">
        <button data-action="minus">−</button>
        <span>${qty}</span>
        <button data-action="plus">+</button>
      </div>
      <span class="cart-line-price">${product.price * qty} ₽</span>
    `;
    line.querySelector('[data-action="minus"]').addEventListener('click', () => {
      decreaseQty(id);
      refreshVisibleCard(id);
    });
    line.querySelector('[data-action="plus"]').addEventListener('click', () => {
      addToCart(id);
      refreshVisibleCard(id);
    });
    container.appendChild(line);
  });

  totalEl.textContent = cartTotal() + ' ₽';
}

function refreshVisibleCard(id) {
  const card = document.querySelector(`.product-card[data-id="${CSS.escape(id)}"]`);
  if (card) renderCardAction(card, id);
}

/* ---------- Cart drawer open/close ---------- */
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

/* ---------- Checkout ---------- */
document.getElementById('checkout-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('form-error');
  errorEl.textContent = '';

  const ids = Object.keys(cart);
  if (ids.length === 0) {
    errorEl.textContent = 'Добавьте хотя бы одно блюдо в корзину';
    return;
  }

  const items = ids.map((id) => ({ id, qty: cart[id] }));
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
