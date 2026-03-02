// public/app.js

const state = {
  now: { collections: [], products: [] },
  archive: { collections: [], products: [] },
  cart: loadCart(),
  selectedSizes: new Map(), // productId -> size
};

function loadCart() {
  try {
    const raw = localStorage.getItem('y_cart');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveCart() {
  localStorage.setItem('y_cart', JSON.stringify(state.cart));
  updateCartBadge();
}

function formatMoney(amount, currency = 'usd') {
  const c = String(currency || 'usd').toUpperCase();
  const sign = c === 'RUB' ? '₽' : (c === 'EUR' ? '€' : '$');
  return sign + (Number(amount).toFixed(2));
}

function updateCartBadge() {
  const count = state.cart.reduce((s, it) => s + (it.quantity || 1), 0);
  const badge = document.getElementById('cartCount');
  if (badge) badge.textContent = String(count);
  updateCartDrawer();
}

async function fetchNow() {
  const res = await fetch('/api/public/now');
  state.now = await res.json();
}

async function fetchArchive() {
  const res = await fetch('/api/public/archive');
  state.archive = await res.json();
}

function renderCollections(containerId, data, options = {}) {
  const mount = document.getElementById(containerId);
  mount.innerHTML = '';

  const byCollection = new Map(data.collections.map(c => [c.id, []]));
  for (const p of data.products) {
    if (byCollection.has(p.collectionId)) byCollection.get(p.collectionId).push(p);
  }

  data.collections.forEach(col => {
    const products = byCollection.get(col.id) || [];
    const block = document.createElement('div');
    block.className = 'collection-block';

    const head = document.createElement('div');
    head.className = 'collection-title';
    head.innerHTML = `<h3>${col.name}</h3>${col.status === 'now' ? '<span class="badge">сейчас</span>' : '<span class="badge">архив</span>'}`;
    block.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'product-grid';
    products.forEach(p => {
      const card = renderProductCard(p, options);
      grid.appendChild(card);
    });

    block.appendChild(grid);
    mount.appendChild(block);
  });
}

function createCarousel(images = [], alt = '') {
  const container = document.createElement('div');
  container.className = 'img-wrap';

  const carousel = document.createElement('div');
  carousel.className = 'carousel';

  const slides = [];
  const imgs = images && images.length ? images : [null];

  imgs.forEach((src, i) => {
    const img = document.createElement('img');
    img.className = 'slide' + (i === 0 ? ' active' : '');
    if (src) {
      img.src = src;
      img.alt = alt;
    } else {
      img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
      img.style.background = '#000';
    }
    slides.push(img);
    carousel.appendChild(img);
  });

  let idx = 0;
  const dots = [];

  function show(i) {
    if (!slides.length) return;
    idx = (i + slides.length) % slides.length;
    slides.forEach((el, k) => el.classList.toggle('active', k === idx));
    dots.forEach((d, k) => d.classList.toggle('active', k === idx));
  }

  if (slides.length > 1) {
    const left = document.createElement('button');
    left.className = 'nav-btn left';
    left.type = 'button';
    left.textContent = '‹';
    left.addEventListener('click', (e) => {
      e.stopPropagation();
      show(idx - 1);
    });

    const right = document.createElement('button');
    right.className = 'nav-btn right';
    right.type = 'button';
    right.textContent = '›';
    right.addEventListener('click', (e) => {
      e.stopPropagation();
      show(idx + 1);
    });

    const dotsWrap = document.createElement('div');
    dotsWrap.className = 'dots';
    for (let i = 0; i < slides.length; i++) {
      const dot = document.createElement('div');
      dot.className = 'dot' + (i === 0 ? ' active' : '');
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        show(i);
      });
      dots.push(dot);
      dotsWrap.appendChild(dot);
    }

    carousel.appendChild(left);
    carousel.appendChild(right);
    carousel.appendChild(dotsWrap);

    carousel.addEventListener('click', () => show(idx + 1));
  }

  container.appendChild(carousel);
  return container;
}

function renderProductCard(p, options = {}) {
  const { archive = false } = options;

  const card = document.createElement('div');
  card.className = 'card';

  const imgWrap = createCarousel(p.images || [], p.name);

  const body = document.createElement('div');
  body.className = 'body';

  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = p.name;

  if (p.preorder) {
    const preorder = document.createElement('span');
    preorder.className = 'badge-preorder';
    preorder.textContent = 'ПРЕДЗАКАЗ';
    name.appendChild(preorder);
  }

  if (p.comingSoon) {
    const soon = document.createElement('span');
    soon.className = 'badge-preorder';
    soon.textContent = 'СКОРО';
    name.appendChild(soon);
  }

  const price = document.createElement('div');
  price.className = 'price';
  price.textContent = formatMoney(p.price, p.currency);

  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.justifyContent = 'space-between';
  row.style.alignItems = 'center';

  const status = document.createElement('span');

  let statusText = 'НЕДОСТУПНО';
  let statusClass = 'badge';

  if (!p.available) {
    statusText = 'НЕДОСТУПНО';
  } else if (p.soldOut) {
    statusText = 'SOLD OUT';
    statusClass += ' sold';
  } else if (p.comingSoon) {
    statusText = 'СКОРО';
  } else if (p.preorder) {
    statusText = 'ПРЕДЗАКАЗ';
  } else {
    statusText = 'В НАЛИЧИИ';
  }

  status.className = statusClass;
  status.textContent = statusText;

  row.appendChild(price);
  row.appendChild(status);

  body.appendChild(name);
  body.appendChild(row);

  // Sizes
  let sizeRow = null;
  if (
    Array.isArray(p.sizes) &&
    p.sizes.length > 0 &&
    !archive &&
    !p.soldOut &&
    p.available &&
    !p.comingSoon
  ) {
    sizeRow = document.createElement('div');
    sizeRow.className = 'size-row';
    p.sizes.forEach(s => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'size-btn';
      b.textContent = s;
      b.addEventListener('click', () => {
        state.selectedSizes.set(p.id, s);
        sizeRow.querySelectorAll('.size-btn').forEach(btn => btn.classList.remove('active'));
        b.classList.add('active');
      });
      sizeRow.appendChild(b);
    });
    body.appendChild(sizeRow);
  }

  // Actions
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'add-btn';

  if (archive) {
    btn.textContent = 'Просмотр';
    btn.classList.add('secondary');
    btn.disabled = true;
  } else if (p.soldOut || !p.available) {
    btn.textContent = 'SOLD OUT';
    btn.disabled = true;
  } else if (p.comingSoon) {
    btn.textContent = 'СКОРО';
    btn.disabled = true;
  } else {
    btn.textContent = 'В корзину';
    btn.addEventListener('click', () => {
      let chosenSize = null;
      if (p.sizes && p.sizes.length > 0) {
        chosenSize = state.selectedSizes.get(p.id);
        if (!chosenSize) {
          alert('Выберите размер');
          return;
        }
      }
      addToCart(p, 1, chosenSize);
      openCart();
    });
  }

  body.appendChild(btn);

  card.appendChild(imgWrap);
  card.appendChild(body);
  return card;
}

function addToCart(product, qty = 1, size = null) {
  const idx = state.cart.findIndex(
    it => it.productId === product.id && it.size === size
  );
  if (idx >= 0) {
    state.cart[idx].quantity += qty;
  } else {
    state.cart.push({
      productId: product.id,
      name: product.name,
      price: product.price,
      currency: product.currency,
      image: product.images && product.images[0] ? product.images[0] : null,
      preorder: !!product.preorder,
      comingSoon: !!product.comingSoon,
      size,
      quantity: qty,
    });
  }
  saveCart();
}

function updateCartDrawer() {
  const list = document.getElementById('cartItems');
  const totalEl = document.getElementById('cartTotal');
  list.innerHTML = '';
  let total = 0;

  state.cart.forEach((it, i) => {
    const item = document.createElement('div');
    item.className = 'cart-item';

    const img = document.createElement('img');
    img.src = it.image || 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    img.alt = it.name;

    const info = document.createElement('div');
    const name = document.createElement('div');
    name.textContent =
      it.name +
      (it.size ? ` / ${it.size}` : '') +
      (it.preorder ? ' (ПРЕДЗАКАЗ)' : '') +
      (it.comingSoon ? ' (СКОРО)' : '');

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = formatMoney(it.price, it.currency);

    const qtyRow = document.createElement('div');
    qtyRow.className = 'qty-row';

    const minus = document.createElement('button');
    minus.className = 'qty-btn';
    minus.textContent = '-';
    minus.addEventListener('click', () => {
      it.quantity = Math.max(1, (it.quantity || 1) - 1);
      saveCart();
    });

    const q = document.createElement('span');
    q.textContent = it.quantity;

    const plus = document.createElement('button');
    plus.className = 'qty-btn';
    plus.textContent = '+';
    plus.addEventListener('click', () => {
      it.quantity = (it.quantity || 1) + 1;
      saveCart();
    });

    qtyRow.appendChild(minus);
    qtyRow.appendChild(q);
    qtyRow.appendChild(plus);

    info.appendChild(name);
    info.appendChild(meta);
    info.appendChild(qtyRow);

    const remove = document.createElement('button');
    remove.className = 'remove-btn';
    remove.textContent = '×';
    remove.title = 'Удалить';
    remove.addEventListener('click', () => {
      state.cart.splice(i, 1);
      saveCart();
    });

    item.appendChild(img);
    item.appendChild(info);
    item.appendChild(remove);

    list.appendChild(item);

    total += (it.price * it.quantity);
  });

  const currency = state.cart[0]?.currency || 'usd';
  totalEl.textContent = formatMoney(total, currency);
}

// Cart drawer open/close
const drawer = {
  el: null, backdrop: null
};
function openCart() {
  drawer.el.classList.add('open');
  drawer.backdrop.classList.add('show');
}
function closeCart() {
  drawer.el.classList.remove('open');
  drawer.backdrop.classList.remove('show');
}

function cartHasComingSoonItems() {
  return state.cart.some(it => it.comingSoon);
}

async function init() {
  drawer.el = document.getElementById('cartDrawer');
  drawer.backdrop = document.getElementById('backdrop');
  document.getElementById('openCart').addEventListener('click', openCart);
  document.getElementById('closeCart').addEventListener('click', closeCart);
  drawer.backdrop.addEventListener('click', closeCart);

  // блокируем переход в checkout если есть "СКОРО"
  const goCheckout = document.getElementById('goCheckout');
  if (goCheckout) {
    goCheckout.addEventListener('click', (e) => {
      if (cartHasComingSoonItems()) {
        e.preventDefault();
        alert('В вашей корзине находится товар, который еще недоступен для покупки. Выберите те, что доступны на данный момент, или дождитесь появления доступа для покупки.');
        openCart();
      }
    });
  }

  await Promise.all([fetchNow(), fetchArchive()]);
  renderCollections('nowContainer', state.now, { archive: false });
  renderCollections('archiveContainer', state.archive, { archive: true });
  updateCartBadge();
}

document.addEventListener('DOMContentLoaded', init);