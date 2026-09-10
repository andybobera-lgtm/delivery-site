let products = [];
let cart = {}; // { productId: qty }

async function loadProducts() {
  const res = await fetch('/api/products');
  products = await res.json();
  renderProducts();
}

function renderProducts() {
  const container = document.getElementById('products');
  container.innerHTML = '';
  products.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'product-card';
    card.innerHTML = `
      <h3>${p.name}</h3>
      <p>${p.description || ''} ${p.weight ? '· ' + p.weight : ''}</p>
      <div class="price-row">
        <strong>${p.price} ₽</strong>
        <button data-id="${p.id}">Добавить</button>
      </div>
    `;
    card.querySelector('button').addEventListener('click', () => addToCart(p.id));
    container.appendChild(card);
  });
}

function addToCart(id) {
  cart[id] = (cart[id] || 0) + 1;
  renderCart();
}

function removeFromCart(id) {
  delete cart[id];
  renderCart();
}

function renderCart() {
  const container = document.getElementById('cart-items');
  const totalEl = document.getElementById('cart-total');
  const ids = Object.keys(cart);

  if (ids.length === 0) {
    container.innerHTML = 'Корзина пуста';
    totalEl.textContent = '0';
    return;
  }

  let total = 0;
  container.innerHTML = '';
  ids.forEach((id) => {
    const product = products.find((p) => p.id === id);
    if (!product) return;
    const qty = cart[id];
    total += product.price * qty;
    const line = document.createElement('div');
    line.className = 'cart-line';
    line.innerHTML = `<span>${product.name} × ${qty}</span><span>${product.price * qty} ₽ <a href="#" data-id="${id}">✕</a></span>`;
    line.querySelector('a').addEventListener('click', (e) => {
      e.preventDefault();
      removeFromCart(id);
    });
    container.appendChild(line);
  });
  totalEl.textContent = total;
}

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

    // Переводим покупателя на страницу оплаты ЮKassa
    window.location.href = data.confirmationUrl;
  } catch (err) {
    errorEl.textContent = 'Ошибка сети, попробуйте ещё раз';
  }
});

loadProducts();
