// public/admin.js

const auth = { token: localStorage.getItem('y_admin_token') || null };

const dom = {
  loginPanel: document.getElementById('loginPanel'),
  adminPanel: document.getElementById('adminPanel'),
  loginUser: document.getElementById('loginUser'),
  loginPass: document.getElementById('loginPass'),
  loginBtn: document.getElementById('loginBtn'),
  loginMsg: document.getElementById('loginMsg'),

  useYooKassa: document.getElementById('useYooKassa'),
  shippingFlatRub: document.getElementById('shippingFlatRub'),
  saveSettings: document.getElementById('saveSettings'),
  settingsMsg: document.getElementById('settingsMsg'),

  colName: document.getElementById('colName'),
  colStatus: document.getElementById('colStatus'),
  colOrder: document.getElementById('colOrder'),
  colDesc: document.getElementById('colDesc'),
  addCollection: document.getElementById('addCollection'),
  collectionsList: document.getElementById('collectionsList'),

  pName: document.getElementById('pName'),
  pPrice: document.getElementById('pPrice'),
  pCurrency: document.getElementById('pCurrency'),
  pCollection: document.getElementById('pCollection'),
  pSizes: document.getElementById('pSizes'),
  pState: document.getElementById('pState'),
  pDesc: document.getElementById('pDesc'),

  pImageFile: document.getElementById('pImageFile'),
  uploadImage: document.getElementById('uploadImage'),
  imagesPreview: document.getElementById('imagesPreview'),

  addProduct: document.getElementById('addProduct'),
  productsList: document.getElementById('productsList'),

  modalBackdrop: document.getElementById('modalBackdrop'),
  modalTitle: document.getElementById('modalTitle'),
  modalBody: document.getElementById('modalBody'),
  modalClose: document.getElementById('modalClose'),
  modalSave: document.getElementById('modalSave'),
  modalMsg: document.getElementById('modalMsg'),
};

let imagesBuffer = [];
let collectionsCache = [];
let productsCache = [];

let modalState = { type: null, id: null, getPayload: null };

async function apiFetch(url, options = {}) {
  const headers = options.headers ? { ...options.headers } : {};
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem('y_admin_token');
    auth.token = null;
    alert('Сессия админа истекла. Войдите заново.');
    location.reload();
  }
  return res;
}

/* Login */
dom.loginBtn.addEventListener('click', login);

async function login() {
  dom.loginMsg.textContent = '';
  const username = dom.loginUser.value.trim();
  const password = dom.loginPass.value;

  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    dom.loginMsg.textContent = data.error || 'Ошибка';
    return;
  }

  auth.token = data.token;
  localStorage.setItem('y_admin_token', auth.token);
  await enterAdmin();
}

async function enterAdmin() {
  dom.loginPanel.style.display = 'none';
  dom.adminPanel.style.display = 'grid';
  await loadSettings();
  await loadCollections();
  await loadProducts();
}

/* Settings */
async function loadSettings() {
  dom.settingsMsg.textContent = '';
  const res = await apiFetch('/api/admin/settings');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    dom.settingsMsg.textContent = data.error || 'Ошибка загрузки настроек';
    return;
  }
  dom.useYooKassa.checked = !!data.useYooKassa;
  if (dom.shippingFlatRub) dom.shippingFlatRub.value = Number(data.shippingFlatRub ?? 550);
}

dom.saveSettings.addEventListener('click', async () => {
  dom.settingsMsg.textContent = 'Сохраняем…';

  const payload = {
    useYooKassa: !!dom.useYooKassa.checked,
    shippingFlatRub: dom.shippingFlatRub ? Math.max(0, Math.round(Number(dom.shippingFlatRub.value) || 0)) : undefined
  };

  const res = await apiFetch('/api/admin/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    dom.settingsMsg.textContent = data.error || 'Ошибка сохранения';
    return;
  }

  dom.settingsMsg.textContent = `OK. useYooKassa=${data.useYooKassa}, shipping=${data.shippingFlatRub ?? '-'} ₽`;
});

/* Modal */
function openModal({ title, type, id, bodyEl, getPayload }) {
  modalState = { type, id, getPayload };
  dom.modalTitle.textContent = title;
  dom.modalBody.innerHTML = '';
  dom.modalBody.appendChild(bodyEl);
  dom.modalMsg.textContent = '';
  dom.modalBackdrop.style.display = 'flex';
}
function closeModal() {
  dom.modalBackdrop.style.display = 'none';
  modalState = { type: null, id: null, getPayload: null };
}
dom.modalClose.addEventListener('click', closeModal);
dom.modalBackdrop.addEventListener('click', (e) => { if (e.target === dom.modalBackdrop) closeModal(); });

dom.modalSave.addEventListener('click', async () => {
  if (!modalState.getPayload) return;
  dom.modalMsg.textContent = 'Сохраняем…';
  const payload = modalState.getPayload();

  const url = modalState.type === 'collection'
    ? `/api/collections/${modalState.id}`
    : `/api/products/${modalState.id}`;

  const res = await apiFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    dom.modalMsg.textContent = data.error || 'Ошибка сохранения';
    return;
  }
  dom.modalMsg.textContent = 'OK';
  await loadCollections();
  await loadProducts();
  setTimeout(closeModal, 250);
});

/* Collections */
async function loadCollections() {
  const res = await fetch('/api/public/collections');
  const list = await res.json().catch(() => ([]));
  collectionsCache = Array.isArray(list) ? list : [];

  dom.pCollection.innerHTML = '';
  collectionsCache.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = `${c.name} (${c.status})`;
    dom.pCollection.appendChild(o);
  });

  dom.collectionsList.innerHTML = '';
  collectionsCache.forEach(c => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <div><strong>${c.name}</strong> — <span style="color:#666">${c.status}</span></div>
      <div style="font-size:12px; color:#666;">order: ${c.order ?? ''} | ${c.description ?? ''}</div>
    `;

    const actions = document.createElement('div');
    actions.className = 'actions';

    const edit = document.createElement('button');
    edit.className = 'mini-btn secondary';
    edit.textContent = 'редактировать';
    edit.addEventListener('click', () => openEditCollection(c));

    const toNow = document.createElement('button');
    toNow.className = 'mini-btn secondary';
    toNow.textContent = 'now';
    toNow.addEventListener('click', () => updateCollection(c.id, { status: 'now' }));

    const toArc = document.createElement('button');
    toArc.className = 'mini-btn secondary';
    toArc.textContent = 'archive';
    toArc.addEventListener('click', () => updateCollection(c.id, { status: 'archive' }));

    const del = document.createElement('button');
    del.className = 'mini-btn danger';
    del.textContent = 'удалить';
    del.addEventListener('click', async () => {
      if (!confirm('Удалить коллекцию?')) return;
      const r = await apiFetch(`/api/collections/${c.id}`, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return alert(d.error || 'Ошибка удаления');
      await loadCollections();
    });

    actions.append(edit, toNow, toArc, del);
    item.appendChild(actions);
    dom.collectionsList.appendChild(item);
  });
}

function openEditCollection(c) {
  const wrap = document.createElement('div');
  wrap.className = 'row';

  wrap.innerHTML = `
    <div>
      <label>Название</label>
      <input id="m_colName" type="text" value="${c.name ?? ''}">
    </div>
    <div>
      <label>Статус</label>
      <select id="m_colStatus">
        <option value="now">now</option>
        <option value="archive">archive</option>
      </select>
    </div>
    <div>
      <label>Порядок</label>
      <input id="m_colOrder" type="number" value="${c.order ?? 1}">
    </div>
    <div>
      <label>Описание</label>
      <input id="m_colDesc" type="text" value="${c.description ?? ''}">
    </div>
  `;
  wrap.querySelector('#m_colStatus').value = c.status;

  openModal({
    title: `Коллекция: ${c.name}`,
    type: 'collection',
    id: c.id,
    bodyEl: wrap,
    getPayload: () => ({
      name: wrap.querySelector('#m_colName').value.trim(),
      status: wrap.querySelector('#m_colStatus').value,
      order: Number(wrap.querySelector('#m_colOrder').value) || 1,
      description: wrap.querySelector('#m_colDesc').value.trim()
    })
  });
}

dom.addCollection.addEventListener('click', async () => {
  const payload = {
    name: dom.colName.value.trim(),
    status: dom.colStatus.value,
    order: Number(dom.colOrder.value) || 1,
    description: dom.colDesc.value.trim()
  };
  if (!payload.name) return alert('Название обязательно');

  const res = await apiFetch('/api/collections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return alert(data.error || 'Ошибка');

  dom.colName.value = '';
  dom.colDesc.value = '';
  await loadCollections();
});

async function updateCollection(id, patch) {
  const res = await apiFetch(`/api/collections/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return alert(data.error || 'Ошибка сохранения');
  await loadCollections();
}

/* Create product images */
dom.uploadImage.addEventListener('click', async () => {
  const files = Array.from(dom.pImageFile.files || []);
  if (!files.length) return alert('Выберите файлы');

  for (const file of files) {
    const fd = new FormData();
    fd.append('image', file);
    const res = await apiFetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return alert(data.error || 'Ошибка загрузки');
    imagesBuffer.push(data.url);
  }

  dom.pImageFile.value = '';
  renderImagesPreview();
});

function renderImagesPreview() {
  dom.imagesPreview.innerHTML = '';
  imagesBuffer.forEach((url, index) => {
    const wrap = document.createElement('div');
    wrap.className = 'thumb-card';

    const img = document.createElement('img');
    img.src = url;

    const del = document.createElement('button');
    del.className = 'mini-btn danger';
    del.textContent = 'удалить';
    del.addEventListener('click', () => {
      imagesBuffer.splice(index, 1);
      renderImagesPreview();
    });

    wrap.appendChild(img);
    wrap.appendChild(del);
    dom.imagesPreview.appendChild(wrap);
  });
}

/* Products */
dom.addProduct.addEventListener('click', async () => {
  const name = dom.pName.value.trim();
  const price = Number(dom.pPrice.value);
  const currency = (dom.pCurrency.value.trim() || 'rub');
  const collectionId = dom.pCollection.value;
  const sizes = dom.pSizes.value.trim();
  const desc = dom.pDesc.value.trim();
  const st = dom.pState.value;

  if (!name || !price || !collectionId) return alert('Заполните название, цену и коллекцию');

  const payload = {
    name,
    price,
    currency,
    collectionId,
    sizes,
    description: desc,
    images: imagesBuffer.slice(),
    available: st !== 'hidden',
    soldOut: st === 'soldout',
    preorder: st === 'preorder',
    comingSoon: st === 'soon'
  };

  const res = await apiFetch('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) return alert(data.error || 'Ошибка');

  dom.pName.value = '';
  dom.pPrice.value = '';
  dom.pSizes.value = '';
  dom.pDesc.value = '';
  imagesBuffer = [];
  renderImagesPreview();

  await loadProducts();
});

function productStateLabel(p) {
  if (!p.available) return 'скрыт';
  if (p.soldOut) return 'SOLD OUT';
  if (p.comingSoon) return 'СКОРО';
  if (p.preorder) return 'ПРЕДЗАКАЗ';
  return 'в наличии';
}

async function loadProducts() {
  const res = await fetch('/api/public/products');
  const list = await res.json().catch(() => ([]));
  productsCache = Array.isArray(list) ? list : [];

  dom.productsList.innerHTML = '';
  productsCache.forEach(p => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <div>
        <strong>${p.name}</strong> | ${p.currency} ${p.price} |
        <span style="${(p.preorder || p.comingSoon) ? 'color:#c00;font-weight:700;' : ''}">${productStateLabel(p)}</span>
      </div>
      <div style="font-size:12px;color:#666;">sizes: ${(p.sizes||[]).join(', ')} | collection: ${p.collectionId}</div>
      <div class="thumb-row">
        ${(p.images || []).slice(0, 6).map(u => `<img src="${u}" style="width:50px;height:50px;object-fit:cover;border:1px solid #eee;">`).join('')}
      </div>
    `;

    const actions = document.createElement('div');
    actions.className = 'actions';

    const edit = document.createElement('button');
    edit.className = 'mini-btn secondary';
    edit.textContent = 'редактировать';
    edit.addEventListener('click', () => openEditProduct(p));

    const del = document.createElement('button');
    del.className = 'mini-btn danger';
    del.textContent = 'удалить';
    del.addEventListener('click', async () => {
      if (!confirm('Удалить товар?')) return;
      const r = await apiFetch(`/api/products/${p.id}`, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return alert(d.error || 'Ошибка удаления');
      await loadProducts();
    });

    actions.append(edit, del);
    item.appendChild(actions);
    dom.productsList.appendChild(item);
  });
}

function openEditProduct(p) {
  let editImages = Array.isArray(p.images) ? p.images.slice() : [];

  const wrap = document.createElement('div');

  const sizesStr = Array.isArray(p.sizes) ? p.sizes.join(',') : (p.sizes || '');
  wrap.innerHTML = `
    <div class="row">
      <div>
        <label>Название</label>
        <input id="m_pName" type="text" value="${p.name ?? ''}">
      </div>
      <div>
        <label>Цена</label>
        <input id="m_pPrice" type="number" step="1" value="${p.price ?? ''}">
      </div>
      <div>
        <label>Валюта</label>
        <input id="m_pCurrency" type="text" value="${p.currency ?? 'rub'}">
      </div>
      <div>
        <label>Коллекция</label>
        <select id="m_pCollection"></select>
      </div>
      <div>
        <label>Размеры (через запятую)</label>
        <input id="m_pSizes" type="text" value="${sizesStr}">
      </div>
      <div>
        <label>Состояние</label>
        <select id="m_pState">
          <option value="available">available</option>
          <option value="preorder">preorder</option>
          <option value="soon">soon</option>
          <option value="soldout">soldout</option>
          <option value="hidden">hidden</option>
        </select>
      </div>
      <div style="grid-column: 1 / -1;">
        <label>Описание</label>
        <textarea id="m_pDesc" rows="3">${p.description ?? ''}</textarea>
      </div>
    </div>

    <div style="margin-top:10px;">
      <div style="font-weight:700; margin-bottom:6px;">Изображения товара</div>
      <div class="help">Можно удалять и менять порядок. Новые добавляются через загрузку.</div>

      <div style="margin-top:8px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        <input id="m_pImageFile" type="file" accept="image/*" multiple />
        <button id="m_uploadImage" class="mini-btn secondary" type="button">Загрузить</button>
      </div>

      <div id="m_imagesPreview" class="thumb-row" style="margin-top:8px;"></div>
    </div>
  `;

  const sel = wrap.querySelector('#m_pCollection');
  collectionsCache.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = `${c.name} (${c.status})`;
    sel.appendChild(o);
  });
  sel.value = p.collectionId;

  const stSel = wrap.querySelector('#m_pState');
  if (!p.available) stSel.value = 'hidden';
  else if (p.comingSoon) stSel.value = 'soon';
  else if (p.preorder) stSel.value = 'preorder';
  else if (p.soldOut) stSel.value = 'soldout';
  else stSel.value = 'available';

  const preview = wrap.querySelector('#m_imagesPreview');
  function renderEditImages() {
    preview.innerHTML = '';
    editImages.forEach((url, idx) => {
      const card = document.createElement('div');
      card.className = 'thumb-card';

      const img = document.createElement('img');
      img.src = url;

      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '6px';

      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'mini-btn secondary';
      up.textContent = '↑';
      up.disabled = idx === 0;
      up.addEventListener('click', () => {
        const t = editImages[idx - 1];
        editImages[idx - 1] = editImages[idx];
        editImages[idx] = t;
        renderEditImages();
      });

      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'mini-btn secondary';
      down.textContent = '↓';
      down.disabled = idx === editImages.length - 1;
      down.addEventListener('click', () => {
        const t = editImages[idx + 1];
        editImages[idx + 1] = editImages[idx];
        editImages[idx] = t;
        renderEditImages();
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'mini-btn danger';
      del.textContent = 'удалить';
      del.addEventListener('click', () => {
        editImages.splice(idx, 1);
        renderEditImages();
      });

      row.append(up, down, del);
      card.append(img, row);
      preview.appendChild(card);
    });
  }
  renderEditImages();

  wrap.querySelector('#m_uploadImage').addEventListener('click', async () => {
    const files = Array.from(wrap.querySelector('#m_pImageFile').files || []);
    if (!files.length) return alert('Выберите файлы');

    for (const file of files) {
      const fd = new FormData();
      fd.append('image', file);
      const res = await apiFetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data.error || 'Ошибка загрузки');
      editImages.push(data.url);
    }

    wrap.querySelector('#m_pImageFile').value = '';
    renderEditImages();
  });

  openModal({
    title: `Товар: ${p.name}`,
    type: 'product',
    id: p.id,
    bodyEl: wrap,
    getPayload: () => {
      const st = wrap.querySelector('#m_pState').value;
      return {
        name: wrap.querySelector('#m_pName').value.trim(),
        price: Number(wrap.querySelector('#m_pPrice').value),
        currency: wrap.querySelector('#m_pCurrency').value.trim() || 'rub',
        collectionId: wrap.querySelector('#m_pCollection').value,
        sizes: wrap.querySelector('#m_pSizes').value,
        description: wrap.querySelector('#m_pDesc').value.trim(),
        available: st !== 'hidden',
        soldOut: st === 'soldout',
        preorder: st === 'preorder',
        comingSoon: st === 'soon',
        images: editImages
      };
    }
  });
}

/* Auto login */
document.addEventListener('DOMContentLoaded', async () => {
  if (auth.token) {
    dom.loginPanel.style.display = 'none';
    dom.adminPanel.style.display = 'grid';
    await loadSettings();
    await loadCollections();
    await loadProducts();
  }
});