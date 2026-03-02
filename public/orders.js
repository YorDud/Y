// public/orders.js

let token = localStorage.getItem('y_admin_token');
let allOrders = [];

async function apiFetch(url, options = {}) {
  const headers = options.headers ? { ...options.headers } : {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem('y_admin_token');
    alert('Нужно войти в админку заново (401).');
    location.href = '/admin.html';
  }
  return res;
}

function rub(amount) {
  return `${Math.round(Number(amount) || 0)} ₽`;
}

function escapeHtml(s='') {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function applyFilters() {
  const status = document.getElementById('statusFilter').value;
  const q = document.getElementById('search').value.trim().toLowerCase();

  let filtered = allOrders.slice();

  if (status !== 'all') filtered = filtered.filter(o => (o.status || '') === status);
  if (q) filtered = filtered.filter(o => String(o.orderNumber || '').toLowerCase().includes(q));

  document.getElementById('count').textContent = `Показано: ${filtered.length}`;
  render(filtered);
}

async function deleteOrder(orderNumber) {
  if (!confirm(`Удалить заказ ${orderNumber}? Это действие необратимо.`)) return;

  const url = `/api/admin/orders/${encodeURIComponent(orderNumber)}`;
  const res = await apiFetch(url, { method: 'DELETE' });

  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!res.ok) {
    alert(`Ошибка удаления заказа.\nHTTP ${res.status}\n${data.error || data.raw || 'unknown error'}`);
    return;
  }

  allOrders = allOrders.filter(o => o.orderNumber !== orderNumber);
  applyFilters();
}

function render(orders) {
  const mount = document.getElementById('list');
  mount.innerHTML = '';
  if (!orders.length) {
    mount.innerHTML = '<p class="muted">Ничего не найдено.</p>';
    return;
  }

  orders.forEach(o => {
    const div = document.createElement('div');
    div.className = 'order';

    const top = document.createElement('div');
    top.style.display = 'flex';
    top.style.justifyContent = 'space-between';
    top.style.gap = '10px';
    top.style.flexWrap = 'wrap';

    top.innerHTML = `
      <div>
        <div style="font-weight:700;">${escapeHtml(o.orderNumber || '')}</div>
        <div class="muted">${escapeHtml(o.createdAt || '')}</div>
      </div>
      <div>
        <span class="badge">${escapeHtml(o.status || '')}</span>
        <span class="badge" style="border-color:#999;color:#666;">${escapeHtml(o.payment?.status || '')}</span>
      </div>
    `;

    const customer = document.createElement('div');
    customer.className = 'muted';
    customer.innerHTML = `
      <div><strong>ФИО:</strong> ${escapeHtml(o.customer?.fullName || '')}</div>
      <div><strong>Email:</strong> ${escapeHtml(o.customer?.email || '')}</div>
      <div><strong>Телефон:</strong> ${escapeHtml(o.customer?.phone || '')}</div>
      <div><strong>Комментарий:</strong> ${escapeHtml(o.customer?.comment || '')}</div>
    `;

    const shipping = document.createElement('div');
    shipping.className = 'muted';
    shipping.innerHTML = `
      <div><strong>Доставка:</strong> ${escapeHtml(o.shipping?.carrierLabel || o.shipping?.carrier || '')}</div>
      <div><strong>Пункт:</strong> ${escapeHtml(o.shipping?.pvzAddress || '')}</div>
      <div><strong>Индекс:</strong> ${escapeHtml(o.shipping?.postcode || '')}</div>
      <div><strong>Координаты:</strong> ${o.shipping ? `lat=${o.shipping.lat}, lon=${o.shipping.lon}` : '-'}</div>
    `;

    const items = document.createElement('div');
    items.className = 'items';
    items.innerHTML = (o.items || []).map(it => `
      <div class="it">
        <div>
          <div style="font-weight:600;">
            ${escapeHtml(it.name || '')}
            ${it.preorder ? `<span class="badge" style="border-color:#c00;color:#c00;margin-left:6px;">ПРЕДЗАКАЗ</span>` : ''}
          </div>
          <div class="muted">size: ${escapeHtml(it.size || '-')} | color: ${escapeHtml(it.color || '-')} | qty: ${it.quantity}</div>
        </div>
        <div style="text-align:right;">${rub((it.priceRub || 0) * (it.quantity || 1))}</div>
      </div>
    `).join('');

    const totals = document.createElement('div');
    totals.className = 'totals';
    totals.innerHTML = `
      <div class="line"><span class="muted">Товары</span><strong>${rub(o.totals?.itemsTotalRub || 0)}</strong></div>
      <div class="line"><span class="muted">Доставка</span><strong>${rub(o.totals?.shippingRub || 0)}</strong></div>
      <div class="line"><span class="muted">Итого</span><strong>${rub(o.totals?.orderTotalRub || 0)}</strong></div>
      <div class="muted">paymentId: ${escapeHtml(o.payment?.paymentId || '')}</div>
    `;

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';
    actions.style.flexWrap = 'wrap';
    actions.style.alignItems = 'center';

    const delBtn = document.createElement('button');
    delBtn.className = 'mini-btn danger';
    delBtn.textContent = 'Удалить заказ';
    delBtn.addEventListener('click', () => deleteOrder(o.orderNumber));

    actions.appendChild(delBtn);

    div.appendChild(top);
    div.appendChild(customer);
    div.appendChild(shipping);
    div.appendChild(items);
    div.appendChild(totals);
    div.appendChild(actions);

    mount.appendChild(div);
  });
}

async function load() {
  const res = await apiFetch('/api/admin/orders');
  const data = await res.json().catch(() => ([]));
  if (!res.ok) {
    alert(data.error || 'Ошибка загрузки заказов');
    return;
  }
  allOrders = Array.isArray(data) ? data : [];
  applyFilters();
}

document.getElementById('refresh').addEventListener('click', load);
document.getElementById('statusFilter').addEventListener('change', applyFilters);
document.getElementById('search').addEventListener('input', applyFilters);

document.getElementById('exportCsv').addEventListener('click', async () => {
  const res = await apiFetch('/api/admin/orders.csv');
  if (!res.ok) {
    alert('Не удалось скачать CSV');
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'orders.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

document.getElementById('logout').addEventListener('click', () => {
  localStorage.removeItem('y_admin_token');
  location.href = '/admin.html';
});

load();