// public/checkout.js

const state = {
  cart: [],
  carrier: 'cdek',
  selected: null, // { carrier, carrierLabel, pvzAddress, postcode, lat, lon, manual }

  shippingRub: 0,

  map: null,
  pvzPlacemarks: [],
  selectedPlacemark: null,

  manualMode: false,
  manualPlacemark: null,

  _pvzTimer: null,
  _lastQueryKey: null
};

function loadCart() {
  try {
    const raw = localStorage.getItem('y_cart');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function rub(amount) {
  return `${Math.round(Number(amount) || 0)} ₽`;
}

function itemsTotalRub() {
  return state.cart.reduce((s, it) => s + (Math.round(it.price) * Math.round(it.quantity || 1)), 0);
}

function renderCart() {
  const list = document.getElementById('checkoutList');
  list.innerHTML = '';
  if (state.cart.length === 0) {
    list.innerHTML = '<p>Корзина пуста. Вернитесь на главную страницу, чтобы добавить товары.</p>';
    return;
  }

  state.cart.forEach(it => {
    const row = document.createElement('div');
    row.className = 'ck-row';

    const grid = document.createElement('div');
    grid.className = 'ck-row-grid';

    const img = document.createElement('img');
    img.src = it.image || 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    img.alt = it.name;

    const info = document.createElement('div');
    const t1 = document.createElement('div');
    t1.textContent = it.name + (it.size ? ` / ${it.size}` : '');
    const t2 = document.createElement('div');
    t2.className = 'ck-meta';
    t2.textContent = `${rub(it.price)} × ${it.quantity}`;
    info.appendChild(t1);
    info.appendChild(t2);

    const sum = document.createElement('div');
    sum.textContent = rub(Math.round(it.price) * Math.round(it.quantity || 1));

    grid.appendChild(img);
    grid.appendChild(info);
    grid.appendChild(sum);

    row.appendChild(grid);
    list.appendChild(row);
  });
}

function renderTotals() {
  const items = itemsTotalRub();
  document.getElementById('itemsTotal').textContent = rub(items);
  document.getElementById('shippingCost').textContent = rub(state.shippingRub);
  document.getElementById('checkoutTotal').textContent = rub(items + state.shippingRub);
}

function setMapNote(text) {
  document.getElementById('mapNote').textContent = text;
}

function carrierLabel(carrier) {
  return carrier === 'cdek' ? 'СДЭК (ПВЗ)' : 'Почта России (отделение)';
}

async function loadShippingFromServer() {
  const r = await fetch('/api/public/shipping');
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'shipping load error');
  state.shippingRub = Math.round(Number(data.shippingFlatRub) || 0);
  renderTotals();
}

/* ===== Map: organization search ===== */

function clearPvzPlacemarks() {
  if (!state.map) return;
  state.pvzPlacemarks.forEach(pm => state.map.geoObjects.remove(pm));
  state.pvzPlacemarks = [];
  state.selectedPlacemark = null;
}

function clearManualPlacemark() {
  if (!state.map) return;
  if (state.manualPlacemark) {
    state.map.geoObjects.remove(state.manualPlacemark);
    state.manualPlacemark = null;
  }
}

function matchesCarrierText(text) {
  const isCdek = state.carrier === 'cdek';
  const hay = String(text || '').toLowerCase();

  if (isCdek) return hay.includes('сдэк') || hay.includes('cdek');

  // Почта: фильтр мягче, иначе часто режет результаты
  return hay.includes('почта') || hay.includes('почтов') || hay.includes('russian post');
}

async function reversePostcode(coords) {
  try {
    const res = await ymaps.geocode(coords, { results: 1 });
    const o = res.geoObjects.get(0);
    const meta = o?.properties?.get('metaDataProperty');
    const addr = meta?.GeocoderMetaData?.Address;
    return addr?.postal_code ? String(addr.postal_code) : '';
  } catch {
    return '';
  }
}

async function selectPlacemark(pm, data) {
  if (state.selectedPlacemark) {
    state.selectedPlacemark.options.set('preset', 'islands#blackDotIcon');
  }
  pm.options.set('preset', 'islands#redDotIcon');
  state.selectedPlacemark = pm;

  const postcode = await reversePostcode([data.lat, data.lon]); // может быть пустым — это ок

  state.selected = {
    carrier: state.carrier,
    carrierLabel: carrierLabel(state.carrier),
    pvzAddress: data.address,
    postcode: postcode || '',
    lat: data.lat,
    lon: data.lon,
    manual: false
  };

  document.getElementById('address').value = `${data.address} — ${carrierLabel(state.carrier)}`;
  document.getElementById('postcode').value = postcode || '';

  setMapNote(
    postcode
      ? `Выбрано: ${carrierLabel(state.carrier)}, индекс ${postcode}`
      : `Выбрано: ${carrierLabel(state.carrier)} (индекс не найден)`
  );
}

function boundsKey(bounds) {
  const b = bounds.flat().map(n => Number(n).toFixed(3)).join(',');
  return `${state.carrier}:${b}`;
}

async function searchInBounds(query, bounds) {
  const results = await ymaps.search(query, {
    boundedBy: bounds,
    strictBounds: true,
    results: 50
  });
  return results.geoObjects;
}

async function loadPvzForCurrentBounds() {
  if (!state.map) return;
  if (state.manualMode) return;

  const bounds = state.map.getBounds();
  if (!bounds) return;

  const key = boundsKey(bounds);
  if (key === state._lastQueryKey) return;
  state._lastQueryKey = key;

  clearPvzPlacemarks();
  setMapNote('Загружаем пункты на карте…');

  const queries = state.carrier === 'cdek'
    ? ['СДЭК пункт выдачи', 'СДЭК']
    : ['Почтовое отделение', 'Отделение почтовой связи', 'Почта России'];

  try {
    let geoObjects = null;

    for (const q of queries) {
      const objs = await searchInBounds(q, bounds);
      if (objs && objs.getLength && objs.getLength() > 0) {
        geoObjects = objs;
        break;
      }
    }

    if (!geoObjects || geoObjects.getLength() === 0) {
      setMapNote('Пункты не найдены в текущей области. Увеличьте масштаб или переместите карту.');
      return;
    }

    const count = geoObjects.getLength();
    let shown = 0;

    for (let i = 0; i < count && shown < 50; i++) {
      const obj = geoObjects.get(i);

      const name = obj.properties.get('name') || '';
      const addr = obj.properties.get('address') || obj.getAddressLine?.() || '';
      const fullText = `${name} ${addr}`;

      if (!matchesCarrierText(fullText)) continue;

      const coords = obj.geometry.getCoordinates();
      const data = { name, address: addr || name, lat: coords[0], lon: coords[1] };

      const pm = new ymaps.Placemark([data.lat, data.lon], {
        hintContent: name || carrierLabel(state.carrier),
        balloonContent: `${name ? `<strong>${name}</strong><br/>` : ''}${addr}`
      }, {
        preset: 'islands#blackDotIcon'
      });

      pm.events.add('click', async () => {
        await selectPlacemark(pm, data);
      });

      state.map.geoObjects.add(pm);
      state.pvzPlacemarks.push(pm);
      shown++;
    }

    if (!shown) {
      setMapNote('Ничего не подошло по фильтру. Попробуйте другой масштаб/район.');
      return;
    }

    setMapNote(`Пунктов в области: ${shown}. Кликните по нужному.`);
  } catch (e) {
    console.error(e);
    setMapNote('Ошибка поиска по карте. Проверьте ключ Яндекс.Карт и интернет.');
  }
}

function schedulePvzReload() {
  clearTimeout(state._pvzTimer);
  state._pvzTimer = setTimeout(() => {
    state._lastQueryKey = null;
    loadPvzForCurrentBounds();
  }, 350);
}

/* ===== Manual mode ===== */

function setManualMode(on) {
  state.manualMode = !!on;

  const addrInput = document.getElementById('address');
  const postcodeEl = document.getElementById('postcode');

  state.selected = null;
  addrInput.value = '';
  postcodeEl.value = '';

  if (state.manualMode) {
    clearPvzPlacemarks();
    setMapNote('Введите адрес вручную (ПВЗ/отделение) — мы поставим точку на карте.');
    addrInput.readOnly = false;
    addrInput.placeholder = 'Например: Москва, Тверская 1';
  } else {
    clearManualPlacemark();
    setMapNote('Пункт не выбран');
    addrInput.readOnly = true;
    addrInput.placeholder = 'Выберите пункт на карте';
    state._lastQueryKey = null;
    loadPvzForCurrentBounds();
  }
}

async function geocodeManualAddress(address) {
  if (!state.map) return;

  const q = String(address || '').trim();
  if (q.length < 6) return;

  setMapNote('Ищем адрес…');

  try {
    const res = await ymaps.geocode(q, { results: 1 });
    const obj = res.geoObjects.get(0);
    if (!obj) {
      setMapNote('Адрес не найден. Уточните адрес.');
      return;
    }

    const coords = obj.geometry.getCoordinates();
    const addressLine = obj.getAddressLine() || q;

    let postcode = '';
    try {
      const meta = obj.properties.get('metaDataProperty');
      const addr = meta?.GeocoderMetaData?.Address;
      postcode = addr?.postal_code ? String(addr.postal_code) : '';
    } catch {}

    if (!postcode) postcode = await reversePostcode(coords);
    if (!postcode) postcode = ''; // разрешаем без индекса

    clearManualPlacemark();

    state.manualPlacemark = new ymaps.Placemark(coords, {
      hintContent: 'Ваш адрес',
      balloonContent: `<strong>Ваш адрес</strong><br/>${addressLine}<br/>Индекс: ${postcode || '—'}`
    }, {
      preset: 'islands#blueDotIcon'
    });

    state.map.geoObjects.add(state.manualPlacemark);
    state.map.setCenter(coords, Math.max(state.map.getZoom(), 12));

    document.getElementById('address').value = addressLine;
    document.getElementById('postcode').value = postcode;

    state.selected = {
      carrier: state.carrier,
      carrierLabel: carrierLabel(state.carrier),
      pvzAddress: addressLine,
      postcode,
      lat: coords[0],
      lon: coords[1],
      manual: true
    };

    setMapNote(
      postcode
        ? `Адрес задан вручную. ${carrierLabel(state.carrier)}, индекс ${postcode}`
        : `Адрес задан вручную. ${carrierLabel(state.carrier)} (индекс не найден)`
    );
  } catch (e) {
    console.error(e);
    setMapNote('Ошибка геокодирования адреса. Попробуйте снова.');
  }
}

/* ===== Init UI ===== */

function initCarrierRadios() {
  document.querySelectorAll('input[name="carrier"]').forEach(r => {
    r.addEventListener('change', async (e) => {
      state.carrier = e.target.value;

      state.selected = null;
      document.getElementById('address').value = '';
      document.getElementById('postcode').value = '';
      setMapNote('Пункт не выбран');

      if (!state.manualMode) {
        state._lastQueryKey = null;
        await loadPvzForCurrentBounds();
      } else {
        clearManualPlacemark();
      }
    });
  });
}

function initManualToggle() {
  const toggle = document.getElementById('manualAddressToggle');
  if (!toggle) return;

  toggle.addEventListener('change', () => {
    setManualMode(toggle.checked);
  });

  const addrInput = document.getElementById('address');
  let t = null;

  addrInput.addEventListener('input', () => {
    if (!state.manualMode) return;
    clearTimeout(t);
    t = setTimeout(() => geocodeManualAddress(addrInput.value), 600);
  });
}

function initMap() {
  if (!window.ymaps) return;

  ymaps.ready(async () => {
    state.map = new ymaps.Map('map', {
      center: [55.751244, 37.618423],
      zoom: 10,
      controls: ['zoomControl', 'searchControl']
    });

    setManualMode(false);
    await loadPvzForCurrentBounds();

    state.map.events.add('boundschange', schedulePvzReload);

    try {
      await loadShippingFromServer();
    } catch (e) {
      console.error(e);
      state.shippingRub = 550;
      renderTotals();
    }
  });
}

/* ===== Submit order ===== */

function calcLocalOrderSummary(cart) {
  const items = cart.map(it => ({
    name: it.name,
    size: it.size || null,
    color: it.color || null,
    quantity: it.quantity,
    price: Math.round(it.price),
    image: it.image || null
  }));
  const total = itemsTotalRub() + state.shippingRub;
  return { items, total };
}

async function submitOrder() {
  if (state.cart.length === 0) return alert('Корзина пуста.');

  const fullName = document.getElementById('fullName').value.trim();
  if (fullName.split(/\s+/).length < 2) {
    alert('ФИО обязательно (минимум имя и фамилия через пробел). Пример: Иванов Иван Иванович');
    return;
  }

  const customer = {
    fullName,
    email: document.getElementById('email').value.trim(),
    phone: document.getElementById('phone').value.trim(),
    comment: document.getElementById('comment').value.trim()
  };

  if (!customer.email || !customer.phone) {
    alert('Заполните Email и телефон.');
    return;
  }

  if (!state.selected) {
    alert(state.manualMode
      ? 'Введите адрес вручную так, чтобы он определился на карте.'
      : 'Выберите пункт выдачи/отделение: кликните по точке на карте.'
    );
    return;
  }

  const postcodeInput = document.getElementById('postcode').value.trim();

  const payload = {
    customer,
    cart: state.cart.map(it => ({
      productId: it.productId,
      quantity: it.quantity,
      size: it.size || null,
      color: it.color || null
    })),
    shipping: {
      carrier: state.selected.carrier,
      pvzAddress: document.getElementById('address').value.trim() || state.selected.pvzAddress,
      postcode: postcodeInput || state.selected.postcode || '',
      lat: state.selected.lat,
      lon: state.selected.lon,
      manual: !!state.selected.manual
    }
  };

  const btn = document.getElementById('payBtn');
  btn.disabled = true;
  btn.textContent = 'Оформляем…';

  const res = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    btn.disabled = false;
    btn.textContent = 'Оформить';
    alert(data.error || 'Ошибка оформления');
    return;
  }

  const summary = calcLocalOrderSummary(state.cart);
  try {
    localStorage.setItem('y_last_order', JSON.stringify({
      orderNumber: data.orderNumber,
      items: summary.items,
      total: summary.total
    }));
  } catch {}

  if (data.confirmationUrl) {
    location.href = data.confirmationUrl;
  } else {
    try { localStorage.removeItem('y_cart'); } catch {}
    location.href = `/payment-success.html?order=${encodeURIComponent(data.orderNumber)}`;
  }
}

function init() {
  state.cart = loadCart();
  renderCart();
  initCarrierRadios();
  initManualToggle();
  renderTotals();
  initMap();
  document.getElementById('payBtn').addEventListener('click', submitOrder);
}

document.addEventListener('DOMContentLoaded', init);