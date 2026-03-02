require('dotenv').config();

const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');

const {
  PORT = 3000,
  ALLOWED_ORIGIN = `http://localhost:${PORT}`,

  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  JWT_SECRET = 'change_me',

  BASE_URL = `http://localhost:${PORT}`,

  // YooKassa
  YOOKASSA_SHOP_ID,
  YOOKASSA_SECRET_KEY,

  // Mail (orders)
  ORDER_SMTP_HOST,
  ORDER_SMTP_PORT,
  ORDER_SMTP_SECURE,
  ORDER_EMAIL,
  ORDER_EMAIL_PASSWORD,

  // Mail (client)
  CLIENT_SMTP_HOST,
  CLIENT_SMTP_PORT,
  CLIENT_SMTP_SECURE,
  CLIENT_EMAIL,
  CLIENT_EMAIL_PASSWORD,

  SUPPORT_EMAIL = '',
  SUPPORT_PHONE = '',
} = process.env;

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }));

// raw for webhook only
app.use((req, res, next) => {
  if (req.path === '/api/webhook/yookassa') return next();
  return express.json({ limit: '10mb' })(req, res, next);
});
app.use(express.urlencoded({ extended: true }));

const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const COLLECTIONS_FILE = path.join(DATA_DIR, 'collections.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

async function safeReadJSON(file, fallback) {
  try {
    const raw = await fsp.readFile(file, 'utf-8');
    return JSON.parse(raw || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}
async function writeJSON(file, data) {
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fsp.rename(tmp, file);
}

async function ensureDataFiles() {
  if (!fs.existsSync(PRODUCTS_FILE)) await writeJSON(PRODUCTS_FILE, []);
  if (!fs.existsSync(COLLECTIONS_FILE)) {
    await writeJSON(COLLECTIONS_FILE, [
      { id: 'c_now_1', name: 'Y — NOW', status: 'now', description: 'Текущая коллекция в продаже', order: 1 }
    ]);
  }
  if (!fs.existsSync(ORDERS_FILE)) await writeJSON(ORDERS_FILE, []);

  const defaults = { useYooKassa: false, shippingFlatRub: 550 };
  if (!fs.existsSync(SETTINGS_FILE)) await writeJSON(SETTINGS_FILE, defaults);

  const st = await safeReadJSON(SETTINGS_FILE, null);
  if (!st || typeof st !== 'object') {
    await writeJSON(SETTINGS_FILE, defaults);
  } else {
    const merged = {
      useYooKassa: !!st.useYooKassa,
      shippingFlatRub: Number.isFinite(Number(st.shippingFlatRub)) ? Number(st.shippingFlatRub) : 550
    };
    await writeJSON(SETTINGS_FILE, merged);
  }
}
ensureDataFiles();

function genId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ========== Uploads ========== */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const safeBase = path.basename(file.originalname, ext).replace(/[^a-z0-9_-]/gi, '_');
    cb(null, `${Date.now()}_${safeBase}${ext}`);
  }
});
const upload = multer({ storage });

/* ========== Auth ========== */
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/* ========== Public: now/archive ========== */
app.get('/api/public/now', async (req, res) => {
  const collections = await safeReadJSON(COLLECTIONS_FILE, []);
  const products = await safeReadJSON(PRODUCTS_FILE, []);

  const nowCollections = collections
    .filter(c => c.status === 'now')
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const nowColIds = new Set(nowCollections.map(c => c.id));
  const nowProducts = products.filter(p => nowColIds.has(p.collectionId));

  res.json({ collections: nowCollections, products: nowProducts });
});

app.get('/api/public/archive', async (req, res) => {
  const collections = await safeReadJSON(COLLECTIONS_FILE, []);
  const products = await safeReadJSON(PRODUCTS_FILE, []);

  const archiveCollections = collections
    .filter(c => c.status === 'archive')
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const arcColIds = new Set(archiveCollections.map(c => c.id));
  const archiveProducts = products.filter(p => arcColIds.has(p.collectionId));

  res.json({ collections: archiveCollections, products: archiveProducts });
});

/* ========== Static ========== */
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(PUBLIC_DIR));

/* ========== Login ========== */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '12h' });
    return res.json({ token });
  }
  return res.status(401).json({ error: 'Неверные данные' });
});

/* ========== Settings ========== */
app.get('/api/admin/settings', authRequired, async (req, res) => {
  const settings = await safeReadJSON(SETTINGS_FILE, { useYooKassa: false, shippingFlatRub: 550 });
  res.json(settings);
});

app.put('/api/admin/settings', authRequired, async (req, res) => {
  const current = await safeReadJSON(SETTINGS_FILE, { useYooKassa: false, shippingFlatRub: 550 });
  const next = { ...current, ...req.body };
  next.useYooKassa = !!next.useYooKassa;
  next.shippingFlatRub = Math.max(0, Math.round(Number(next.shippingFlatRub) || 0));
  await writeJSON(SETTINGS_FILE, next);
  res.json(next);
});

/* ========== Orders (admin) ========== */
app.get('/api/admin/orders', authRequired, async (req, res) => {
  const orders = await safeReadJSON(ORDERS_FILE, []);
  orders.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json(orders);
});
app.get('/api/public/shipping', async (req, res) => {
  const settings = await safeReadJSON(SETTINGS_FILE, { useYooKassa: false, shippingFlatRub: 550 });
  res.json({ shippingFlatRub: Math.round(Number(settings.shippingFlatRub) || 0) });
});
app.delete('/api/admin/orders/:orderNumber', authRequired, async (req, res) => {
  try {
    const orderNumber = decodeURIComponent(req.params.orderNumber);
    const orders = await safeReadJSON(ORDERS_FILE, []);
    const idx = orders.findIndex(o => o.orderNumber === orderNumber);
    if (idx === -1) return res.status(404).json({ error: 'Order not found' });
    orders.splice(idx, 1);
    await writeJSON(ORDERS_FILE, orders);
    res.json({ ok: true });
  } catch (e) {
    console.error('Delete order error:', e);
    res.status(500).json({ error: 'Delete order failed' });
  }
});

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
app.get('/api/admin/orders.csv', authRequired, async (req, res) => {
  const orders = await safeReadJSON(ORDERS_FILE, []);
  const header = [
    'orderNumber','createdAt','status','paymentStatus','paymentId',
    'fullName','email','phone',
    'shippingCarrier','pvzTitle','pvzAddress','postcode',
    'itemsTotal','shippingCost','orderTotal',
    'itemName','itemSize','itemColor','quantity','unitPrice','lineTotal',
    'itemPreorder','itemComingSoon'
  ].join(',');

  const lines = [header];

  for (const o of orders) {
    const base = [
      o.orderNumber, o.createdAt, o.status, o.payment?.status, o.payment?.paymentId,
      o.customer?.fullName, o.customer?.email, o.customer?.phone,
      o.shipping?.carrier, o.shipping?.pvzTitle, o.shipping?.pvzAddress, o.shipping?.postcode,
      o.totals?.itemsTotalRub, o.totals?.shippingRub, o.totals?.orderTotalRub
    ];

    const items = Array.isArray(o.items) && o.items.length ? o.items : [null];
    for (const it of items) {
      const row = base.concat([
        it?.name ?? '',
        it?.size ?? '',
        it?.color ?? '',
        it?.quantity ?? '',
        it?.priceRub ?? '',
        it ? (Number(it.priceRub || 0) * Number(it.quantity || 0)) : '',
        it?.preorder ? 'true' : 'false',
        it?.comingSoon ? 'true' : 'false'
      ]).map(csvEscape).join(',');
      lines.push(row);
    }
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
  res.send('\uFEFF' + lines.join('\n'));
});

/* ========== Public data ========== */
app.get('/api/public/collections', async (req, res) => {
  const collections = await safeReadJSON(COLLECTIONS_FILE, []);
  res.json(collections.sort((a, b) => (a.order || 0) - (b.order || 0)));
});
app.get('/api/public/products', async (req, res) => {
  const products = await safeReadJSON(PRODUCTS_FILE, []);
  res.json(products);
});

/* ========== Admin: upload image ========== */
app.post('/api/upload', authRequired, upload.single('image'), (req, res) => {
  res.json({ url: `/uploads/${req.file.filename}` });
});

/* ========== Admin: collections CRUD ========== */
app.post('/api/collections', authRequired, async (req, res) => {
  const { name, status = 'now', description = '', order = 1 } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!['now', 'archive'].includes(status)) return res.status(400).json({ error: 'status must be now|archive' });

  const collections = await safeReadJSON(COLLECTIONS_FILE, []);
  const col = { id: genId('c'), name, status, description, order: Number(order) || 1 };
  collections.push(col);
  await writeJSON(COLLECTIONS_FILE, collections);
  res.json(col);
});

app.put('/api/collections/:id', authRequired, async (req, res) => {
  const collections = await safeReadJSON(COLLECTIONS_FILE, []);
  const idx = collections.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  collections[idx] = { ...collections[idx], ...req.body };
  await writeJSON(COLLECTIONS_FILE, collections);
  res.json(collections[idx]);
});

app.delete('/api/collections/:id', authRequired, async (req, res) => {
  const collections = await safeReadJSON(COLLECTIONS_FILE, []);
  const products = await safeReadJSON(PRODUCTS_FILE, []);
  if (products.some(p => p.collectionId === req.params.id)) {
    return res.status(400).json({ error: 'Нельзя удалить коллекцию — к ней привязаны товары' });
  }
  await writeJSON(COLLECTIONS_FILE, collections.filter(c => c.id !== req.params.id));
  res.json({ ok: true });
});

/* ========== Admin: products CRUD ========== */
app.post('/api/products', authRequired, async (req, res) => {
  let {
    name,
    price,
    currency = 'rub',
    collectionId,
    sizes = [],
    available = true,
    soldOut = false,
    preorder = false,
    comingSoon = false,
    images = [],
    description = ''
  } = req.body || {};

  if (!name) return res.status(400).json({ error: 'name is required' });
  const p = Math.round(Number(price));
  if (!Number.isFinite(p) || p <= 0) return res.status(400).json({ error: 'price must be positive number' });
  if (!collectionId) return res.status(400).json({ error: 'collectionId is required' });

  available = !!available;
  preorder = available ? !!preorder : false;
  comingSoon = available ? !!comingSoon : false;
  soldOut = available ? (!!soldOut && !preorder && !comingSoon) : false;
  if (preorder) {
    soldOut = false;
    comingSoon = false;
  }
  if (comingSoon) {
    soldOut = false;
    preorder = false;
  }

  const products = await safeReadJSON(PRODUCTS_FILE, []);
  const product = {
    id: genId('p'),
    name,
    price: p,
    currency: String(currency).toLowerCase(),
    collectionId,
    sizes: Array.isArray(sizes) ? sizes : String(sizes).split(',').map(s => s.trim()).filter(Boolean),
    available,
    soldOut,
    preorder,
    comingSoon,
    images: Array.isArray(images) ? images : [],
    description
  };
  products.push(product);
  await writeJSON(PRODUCTS_FILE, products);
  res.json(product);
});

app.put('/api/products/:id', authRequired, async (req, res) => {
  const products = await safeReadJSON(PRODUCTS_FILE, []);
  const idx = products.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });

  const incoming = { ...req.body };

  if (incoming.price !== undefined) {
    const p = Math.round(Number(incoming.price));
    if (!Number.isFinite(p) || p <= 0) return res.status(400).json({ error: 'price must be positive number' });
    incoming.price = p;
  }
  if (incoming.sizes !== undefined && !Array.isArray(incoming.sizes)) {
    incoming.sizes = String(incoming.sizes).split(',').map(s => s.trim()).filter(Boolean);
  }
  if (incoming.available !== undefined) incoming.available = !!incoming.available;
  if (incoming.preorder !== undefined) incoming.preorder = !!incoming.preorder;
  if (incoming.soldOut !== undefined) incoming.soldOut = !!incoming.soldOut;
  if (incoming.comingSoon !== undefined) incoming.comingSoon = !!incoming.comingSoon;

  // state normalization
  if (incoming.available === false) {
    incoming.preorder = false;
    incoming.soldOut = false;
    incoming.comingSoon = false;
  }
  if (incoming.preorder === true) {
    incoming.soldOut = false;
    incoming.comingSoon = false;
  }
  if (incoming.comingSoon === true) {
    incoming.soldOut = false;
    incoming.preorder = false;
  }

  products[idx] = { ...products[idx], ...incoming };
  await writeJSON(PRODUCTS_FILE, products);
  res.json(products[idx]);
});

app.delete('/api/products/:id', authRequired, async (req, res) => {
  const products = await safeReadJSON(PRODUCTS_FILE, []);
  await writeJSON(PRODUCTS_FILE, products.filter(p => p.id !== req.params.id));
  res.json({ ok: true });
});

/* ========== Mail helpers ========== */
function createTransport({ host, port, secure, user, pass }) {
  return nodemailer.createTransport({
    host,
    port: Number(port),
    secure: String(secure) === 'true',
    auth: { user, pass }
  });
}

function escapeHtml(str='') {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function rub(amountRub) {
  return `${Math.round(Number(amountRub) || 0)} ₽`;
}

function buildClientEmailHTML(order) {
  const rows = (order.items || []).map(it => {
    const img = it.imageAbs ? `<img src="${it.imageAbs}" width="64" height="64" style="object-fit:cover;border:1px solid #eee;display:block" />` : '';
    const badges = [
      it.preorder ? `<span style="margin-left:8px;font-size:12px;color:#c00;border:1px solid #c00;padding:1px 6px;">ПРЕДЗАКАЗ</span>` : '',
      it.comingSoon ? `<span style="margin-left:8px;font-size:12px;color:#999;border:1px solid #999;padding:1px 6px;">СКОРО</span>` : ''
    ].join('');
    return `
      <tr>
        <td style="padding:10px;border-bottom:1px solid #eee;vertical-align:top;">${img}</td>
        <td style="padding:10px;border-bottom:1px solid #eee;vertical-align:top;">
          <div style="font-weight:600">${escapeHtml(it.name)}${badges}</div>
          <div style="color:#666;font-size:12px;margin-top:4px;">
            ${it.size ? `Размер: ${escapeHtml(it.size)}<br/>` : ''}
            ${it.color ? `Цвет: ${escapeHtml(it.color)}<br/>` : ''}
            Кол-во: ${it.quantity}
          </div>
        </td>
        <td style="padding:10px;border-bottom:1px solid #eee;vertical-align:top;text-align:right;">
          ${rub(it.priceRub * it.quantity)}
        </td>
      </tr>
    `;
  }).join('');

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#fff;color:#000;padding:18px">
    <div style="max-width:720px;margin:0 auto;border:1px solid #e5e5e5;padding:18px">
      <div style="font-weight:700;letter-spacing:.5px">Y — underwear</div>
      <h2 style="margin:12px 0 6px;font-size:20px">Ваш заказ: ${escapeHtml(order.orderNumber)}</h2>
      <div style="color:#666;font-size:13px;margin-bottom:14px">
        Спасибо за заказ. Мы свяжемся с вами при необходимости.
      </div>
      <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
        ${rows}
      </table>
      <div style="margin-top:12px;border-top:1px solid #eee;padding-top:12px;">
        <div style="display:flex;justify-content:space-between;"><span style="color:#666">Товары</span><strong>${rub(order.totals.itemsTotalRub)}</strong></div>
        <div style="display:flex;justify-content:space-between;"><span style="color:#666">Доставка</span><strong>${rub(order.totals.shippingRub)}</strong></div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;"><span style="color:#666">Итого</span><strong>${rub(order.totals.orderTotalRub)}</strong></div>
      </div>
      <div style="margin-top:16px;padding-top:12px;border-top:1px solid #eee;color:#666;font-size:13px">
        <div><strong>Получатель (ФИО):</strong> ${escapeHtml(order.customer.fullName || '')}</div>
        <div><strong>Телефон:</strong> ${escapeHtml(order.customer.phone || '')}</div>
        <div><strong>Email:</strong> ${escapeHtml(order.customer.email || '')}</div>
      </div>
      <div style="margin-top:16px;padding-top:12px;border-top:1px solid #eee;color:#666;font-size:13px">
        <div><strong>Доставка:</strong> ${escapeHtml(order.shipping.carrierLabel)}</div>
        <div><strong>Пункт:</strong> ${escapeHtml(order.shipping.pvzAddress)} (индекс: ${escapeHtml(order.shipping.postcode || '—')})</div>
      </div>
      <div style="margin-top:16px;padding-top:12px;border-top:1px solid #eee;color:#666;font-size:13px">
        <div>Поддержка: <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}">${escapeHtml(SUPPORT_EMAIL)}</a></div>
        <div>Телефон: ${escapeHtml(SUPPORT_PHONE)}</div>
      </div>
    </div>
  </div>`;
}

function buildOrderEmailText(order) {
  const lines = [];
  lines.push(`ORDER: ${order.orderNumber}`);
  lines.push(`STATUS: ${order.status}`);
  lines.push(`PAYMENT_STATUS: ${order.payment.status}`);
  lines.push(`PAYMENT_ID: ${order.payment.paymentId || ''}`);
  lines.push('');
  lines.push('CUSTOMER:');
  lines.push(`Full name: ${order.customer.fullName || ''}`);
  lines.push(`Email: ${order.customer.email || ''}`);
  lines.push(`Phone: ${order.customer.phone || ''}`);
  lines.push(`Comment: ${order.customer.comment || ''}`);
  lines.push('');
  lines.push('DELIVERY:');
  lines.push(`Carrier: ${order.shipping.carrierLabel}`);
  lines.push(`PVZ address: ${order.shipping.pvzAddress}`);
  lines.push(`Postcode: ${order.shipping.postcode || ''}`);
  lines.push(`PVZ coords: lat=${order.shipping.lat}, lon=${order.shipping.lon}`);
  lines.push(`Manual: ${order.shipping.manual ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('ITEMS:');
  (order.items || []).forEach(it => {
    lines.push(
      `- ${it.name}`
        + (it.preorder ? ' [PREORDER]' : '')
        + (it.comingSoon ? ' [SOON]' : '')
        + ` | size=${it.size || '-'} | color=${it.color || '-'} | qty=${it.quantity} | unit=${rub(it.priceRub)}`
    );
  });
  lines.push('');
  lines.push(`ITEMS TOTAL: ${rub(order.totals.itemsTotalRub)}`);
  lines.push(`SHIPPING: ${rub(order.totals.shippingRub)}`);
  lines.push(`ORDER TOTAL: ${rub(order.totals.orderTotalRub)}`);
  return lines.join('\n');
}

function isMailConfigured() {
  return ORDER_SMTP_HOST && ORDER_SMTP_PORT && ORDER_EMAIL && ORDER_EMAIL_PASSWORD &&
         CLIENT_SMTP_HOST && CLIENT_SMTP_PORT && CLIENT_EMAIL && CLIENT_EMAIL_PASSWORD;
}

async function sendOrderEmails(order) {
  if (!isMailConfigured()) return;
  const orderTransport = createTransport({
    host: ORDER_SMTP_HOST,
    port: ORDER_SMTP_PORT,
    secure: ORDER_SMTP_SECURE,
    user: ORDER_EMAIL,
    pass: ORDER_EMAIL_PASSWORD
  });
  await orderTransport.sendMail({
    from: `"Y Orders" <${ORDER_EMAIL}>`,
    to: ORDER_EMAIL,
    subject: `NEW ORDER ${order.orderNumber}`,
    text: buildOrderEmailText(order)
  });
  const clientTransport = createTransport({
    host: CLIENT_SMTP_HOST,
    port: CLIENT_SMTP_PORT,
    secure: CLIENT_SMTP_SECURE,
    user: CLIENT_EMAIL,
    pass: CLIENT_EMAIL_PASSWORD
  });
  await clientTransport.sendMail({
    from: `"Y — underwear" <${CLIENT_EMAIL}>`,
    to: order.customer.email,
    subject: `Ваш заказ ${order.orderNumber} — Y — underwear`,
    html: buildClientEmailHTML(order)
  });
}
/* ========== Helpers for checkout ========== */
function carrierLabelForOrder(carrier) {
  return carrier === 'cdek' ? 'СДЭК (ПВЗ)' : 'Почта России (отделение)';
}

async function buildOrderFromRequest(payload) {
  const { customer, cart, shipping } = payload || {};
  const products = await safeReadJSON(PRODUCTS_FILE, []);
  const mapById = new Map(products.map(p => [p.id, p]));
  const items = [];
  let itemsTotalRub = 0;

  for (const it of cart) {
    const p = mapById.get(it.productId);
    if (!p) throw new Error(`Product not found: ${it.productId}`);
    if (!p.available) throw new Error(`Product not available: ${p.name}`);
    if (p.soldOut) throw new Error(`Product sold out: ${p.name}`);
    if (p.comingSoon) throw new Error(`Product coming soon: ${p.name}`);
    const qty = Math.max(1, Math.round(Number(it.quantity) || 1));
    const priceRub = Math.round(Number(p.price) || 0);
    items.push({
      productId: p.id,
      name: p.name,
      size: it.size || null,
      color: it.color || null,
      quantity: qty,
      priceRub,
      preorder: !!p.preorder,
      comingSoon: !!p.comingSoon,
      image: p.images?.[0] || null,
      imageAbs: p.images?.[0] ? `${BASE_URL}${p.images[0]}` : null
    });
    itemsTotalRub += priceRub * qty;
  }
  const settings = await safeReadJSON(SETTINGS_FILE, { useYooKassa: false, shippingFlatRub: 550 });
  const shippingRub = Math.max(0, Math.round(Number(shipping?.costRub ?? settings.shippingFlatRub) || 0));
  const orderTotalRub = itemsTotalRub + shippingRub;
  const orderNumber = `Y-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${uuidv4().slice(0,8).toUpperCase()}`;
  return {
    id: genId('o'),
    orderNumber,
    createdAt: new Date().toISOString(),

    customer: {
      fullName: customer.fullName,
      email: customer.email,
      phone: customer.phone,
      comment: customer.comment || ''
    },

    shipping: {
      carrier: shipping.carrier,
      carrierLabel: carrierLabelForOrder(shipping.carrier),
      pvzAddress: shipping.pvzAddress,
      postcode: shipping.postcode || '',
      lat: shipping.lat,
      lon: shipping.lon,
      manual: !!shipping.manual
    },

    items,

    totals: {
      itemsTotalRub,
      shippingRub,
      orderTotalRub
    },

    payment: { provider: 'yookassa', status: 'pending', paymentId: null },
    status: 'pending',
    emailsSent: false
  };
}

/* ========== Universal checkout ========== */
app.post('/api/checkout', async (req, res) => {
  try {
    const payload = req.body || {};
    const { customer, cart, shipping } = payload;
    if (!customer || !Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ error: 'Invalid payload' });
    }
    const fullName = String(customer.fullName || '').trim();
    if (fullName.split(/\s+/).length < 2) {
      return res.status(400).json({ error: 'ФИО обязательно (минимум имя и фамилия через пробел)' });
    }
    if (!customer.email || !customer.phone) {
      return res.status(400).json({ error: 'Email и телефон обязательны' });
    }
    if (!shipping || !['cdek', 'russian_post'].includes(String(shipping.carrier || ''))) {
      return res.status(400).json({ error: 'Выберите доставку: СДЭК или Почта России' });
    }
    if (!shipping.pvzAddress || shipping.lat === undefined || shipping.lon === undefined) {
      return res.status(400).json({ error: 'Выберите пункт/адрес на карте' });
    }
    shipping.postcode = String(shipping.postcode || '').trim();
    payload.customer.fullName = fullName;
    const settings = await safeReadJSON(SETTINGS_FILE, { useYooKassa: false, shippingFlatRub: 550 });
    const useYooKassa = !!settings.useYooKassa;
    payload.shipping.costRub = Math.max(0, Math.round(Number(settings.shippingFlatRub) || 0));
    // защита на "СКОРО" еще раз
    const products = await safeReadJSON(PRODUCTS_FILE, []);
    const mapById = new Map(products.map(p => [p.id, p]));
    for (const it of cart) {
      const p = mapById.get(it.productId);
      if (p && p.comingSoon) {
        return res.status(400).json({ error: `В корзине есть товар "${p.name}" (СКОРО), он недоступен для заказа.` });
      }
    }
    const order = await buildOrderFromRequest(payload);

    const orders = await safeReadJSON(ORDERS_FILE, []);
    orders.push(order);
    await writeJSON(ORDERS_FILE, orders);

    if (!useYooKassa) {
      order.status = 'paid';
      order.payment.status = 'succeeded';
      order.payment.paymentId = 'TEST_PAYMENT';
      if (!order.emailsSent) {
        await sendOrderEmails(order);
        order.emailsSent = true;
      }
      await writeJSON(ORDERS_FILE, orders);
      return res.json({ orderNumber: order.orderNumber, confirmationUrl: null });
    }

    if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) {
      return res.status(500).json({ error: 'YooKassa not configured in .env' });
    }

    const idempotenceKey = uuidv4();
    const amountValue = (order.totals.orderTotalRub).toFixed(2);
    const yooPayload = {
      amount: { value: amountValue, currency: 'RUB' },
      confirmation: { type: 'redirect', return_url: `${BASE_URL}/payment-success.html?order=${encodeURIComponent(order.orderNumber)}` },
      capture: true,
      description: `Order ${order.orderNumber}`,
      metadata: { orderNumber: order.orderNumber }
    };

    const yooRes = await axios.post('https://api.yookassa.ru/v3/payments', yooPayload, {
      auth: { username: YOOKASSA_SHOP_ID, password: YOOKASSA_SECRET_KEY },
      headers: { 'Idempotence-Key': idempotenceKey }
    });

    const payment = yooRes.data;
    order.payment.paymentId = payment.id;
    await writeJSON(ORDERS_FILE, orders);

    return res.json({ orderNumber: order.orderNumber, confirmationUrl: payment.confirmation?.confirmation_url });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Checkout error' });
  }
});

/* ========== Verify (thanks page) ========== */
app.post('/api/payment/yookassa/verify', async (req, res) => {
  try {
    const { orderNumber } = req.body || {};
    if (!orderNumber) return res.status(400).json({ error: 'orderNumber required' });

    const orders = await safeReadJSON(ORDERS_FILE, []);
    const order = orders.find(o => o.orderNumber === orderNumber);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (order.payment?.paymentId === 'TEST_PAYMENT') {
      return res.json({ ok: true, status: order.status, paymentStatus: order.payment.status });
    }

    if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) return res.status(500).json({ error: 'YooKassa not configured' });
    if (!order.payment?.paymentId) return res.status(400).json({ error: 'PaymentId missing' });

    const payRes = await axios.get(`https://api.yookassa.ru/v3/payments/${order.payment.paymentId}`, {
      auth: { username: YOOKASSA_SHOP_ID, password: YOOKASSA_SECRET_KEY }
    });
    const payment = payRes.data;

    order.payment.status = payment.status;
    if (payment.status === 'succeeded') order.status = 'paid';
    if (payment.status === 'canceled') order.status = 'canceled';

    await writeJSON(ORDERS_FILE, orders);
    res.json({ ok: true, status: order.status, paymentStatus: payment.status });
  } catch (e) {
    console.error(e?.response?.data || e);
    res.status(500).json({ error: 'Verify error' });
  }
});

/* ========== Webhook ========== */
app.post('/api/webhook/yookassa', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const event = JSON.parse(req.body.toString('utf-8'));
    const type = event?.event;
    const object = event?.object;
    if (!type || !object) return res.status(400).send('bad event');

    const paymentId = object.id;
    const status = object.status;
    const orderNumber = object.metadata?.orderNumber;

    const orders = await safeReadJSON(ORDERS_FILE, []);
    let order = null;

    if (orderNumber) order = orders.find(o => o.orderNumber === orderNumber);
    if (!order) order = orders.find(o => o.payment?.paymentId === paymentId);
    if (!order) return res.status(200).send('ok');

    order.payment.status = status;

    if (type === 'payment.succeeded' || status === 'succeeded') {
      order.status = 'paid';
      if (!order.emailsSent) {
        await sendOrderEmails(order);
        order.emailsSent = true;
      }
    }
    if (type === 'payment.canceled' || status === 'canceled') {
      order.status = 'canceled';
    }

    await writeJSON(ORDERS_FILE, orders);
    res.status(200).send('ok');
  } catch (e) {
    console.error('Webhook error:', e);
    res.status(500).send('error');
  }
});

app.listen(PORT, () => {
  console.log(`Y — underwear server running at ${BASE_URL}`);
});