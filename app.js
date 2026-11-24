// Kcal – en simpel dansk kalorietæller.
// Data gemmes i localStorage på telefonen. Stregkoder slås op i Open Food Facts,
// råvarer kan søges i Frida (DTU), hvis data/frida.json findes.

import { readLabel, parseNutrition } from './ocr.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const MEALS = [
  ['breakfast', 'Morgenmad'],
  ['lunch', 'Frokost'],
  ['dinner', 'Aftensmad'],
  ['snack', 'Snacks'],
];
const MACROS = ['kcal', 'protein', 'carbs', 'fat'];

// ---------- Lager ----------
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('kcal:' + key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('kcal:' + key, JSON.stringify(value));
    } catch {
      toast('Kunne ikke gemme – er lageret fuldt?');
    }
  },
};

const state = {
  day: dateKey(new Date()),
  goals: store.get('goals', { kcal: 2200, protein: 140, carbs: 250, fat: 70 }),
  log: store.get('log', {}),       // { 'YYYY-MM-DD': [{ id, meal, grams, food }] }
  foods: store.get('foods', {}),   // { id: food } – scannede/oprettede/brugte varer
  frida: [],                       // indlæses fra data/frida.json, hvis den findes
};

function save() {
  store.set('goals', state.goals);
  store.set('log', state.log);
  store.set('foods', state.foods);
}

// ---------- Hjælpere ----------
function dateKey(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function parseKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function shiftDay(k, n) {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}
function dayLabel(k) {
  const today = dateKey(new Date());
  if (k === today) return 'I dag';
  if (k === shiftDay(today, -1)) return 'I går';
  if (k === shiftDay(today, 1)) return 'I morgen';
  return parseKey(k).toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' });
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const r0 = (n) => Math.round(n).toLocaleString('da-DK');
const r1 = (n) => (Math.round(n * 10) / 10).toLocaleString('da-DK');
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function nutrients(food, grams) {
  const f = grams / 100;
  return Object.fromEntries(MACROS.map((m) => [m, (food.per100[m] || 0) * f]));
}
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  // Som popover ligger beskeden øverst – også over åbne ark
  try { el.hidePopover(); el.showPopover(); } catch {}
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

// ---------- Dagbog ----------
function entries() {
  return state.log[state.day] || [];
}

function renderDay() {
  $('#day-title').textContent = dayLabel(state.day);
  const list = entries();
  const total = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const e of list) {
    const n = nutrients(e.food, e.grams);
    MACROS.forEach((m) => (total[m] += n[m]));
  }
  const g = state.goals;
  $('#sum-kcal').textContent = r0(total.kcal);
  $('#goal-kcal').textContent = r0(g.kcal);
  const left = g.kcal - total.kcal;
  $('#sum-left').textContent = r0(Math.abs(left));
  $('#left-label').textContent = left >= 0 ? 'tilbage' : 'over';
  setBar('#bar-kcal', total.kcal, g.kcal);
  for (const m of ['protein', 'carbs', 'fat']) {
    $('#m-' + m).textContent = `${r0(total[m])} / ${r0(g[m])} g`;
    setBar('#bar-' + m, total[m], g[m]);
  }

  $('#meals').innerHTML = MEALS.map(([key, label]) => {
    const items = list.filter((e) => e.meal === key);
    const kcal = items.reduce((s, e) => s + nutrients(e.food, e.grams).kcal, 0);
    return `<section class="card">
      <div class="meal-head">
        <h2>${label} <span class="muted">${items.length ? r0(kcal) + ' kcal' : ''}</span></h2>
        <button class="add" data-add-meal="${key}">+ Tilføj</button>
      </div>
      <ul class="list">${items.map((e) => `
        <li data-entry="${e.id}">
          <div><div class="name">${esc(e.food.name)}</div><div class="sub">${r0(e.grams)} g${e.food.brand ? ' · ' + esc(e.food.brand) : ''}</div></div>
          <div class="kcal">${r0(nutrients(e.food, e.grams).kcal)} kcal</div>
        </li>`).join('')}</ul>
    </section>`;
  }).join('');
}

function setBar(sel, value, goal) {
  const el = $(sel);
  el.style.width = Math.min(100, goal ? (value / goal) * 100 : 0) + '%';
  el.classList.toggle('over', goal > 0 && value > goal * 1.05);
}

$('#prev-day').onclick = () => { state.day = shiftDay(state.day, -1); renderDay(); };
$('#next-day').onclick = () => { state.day = shiftDay(state.day, 1); renderDay(); };
$('#day-title').onclick = () => {
  const p = $('#date-picker');
  p.value = state.day;
  if (p.showPicker) p.showPicker(); else p.click();
};
$('#date-picker').onchange = (e) => { if (e.target.value) { state.day = e.target.value; renderDay(); } };

$('#meals').addEventListener('click', (e) => {
  const add = e.target.closest('[data-add-meal]');
  if (add) return openAdd(add.dataset.addMeal);
  const li = e.target.closest('[data-entry]');
  if (li) {
    const entry = entries().find((x) => x.id === li.dataset.entry);
    if (entry) openAmount(entry.food, { entry });
  }
});

// ---------- Navigation ----------
$$('.tabbar [data-view]').forEach((b) => {
  b.onclick = () => {
    $$('.tabbar [data-view]').forEach((x) => x.classList.toggle('active', x === b));
    $$('.view').forEach((v) => (v.hidden = v.id !== 'view-' + b.dataset.view));
    if (b.dataset.view === 'settings') renderSettings();
    else renderDay();
    window.scrollTo(0, 0);
  };
});
$('#fab').onclick = () => openAdd();

$$('[data-close]').forEach((b) => (b.onclick = () => b.closest('dialog').close()));
$$('dialog').forEach((d) =>
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); }) // tryk udenfor lukker
);

// ---------- Tilføj-ark ----------
let currentMeal = null;
let currentTab = 'scan';

function guessMeal() {
  const h = new Date().getHours();
  if (h < 10) return 'breakfast';
  if (h < 14) return 'lunch';
  if (h >= 17 && h < 21) return 'dinner';
  return 'snack';
}

function openAdd(meal) {
  currentMeal = meal || guessMeal();
  delete $('#food-form').dataset.editOnly;
  const sheet = $('#add-sheet');
  if (!sheet.open) sheet.showModal();
  showTab(store.get('lastTab', 'scan'));
}

$('#add-sheet').addEventListener('close', stopScanner);

$$('#add-sheet .seg button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

function showTab(tab) {
  currentTab = tab;
  store.set('lastTab', tab === 'manual' ? 'scan' : tab);
  $$('#add-sheet .seg button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('#add-sheet .tab').forEach((t) => (t.hidden = t.dataset.tab !== tab));
  if (tab === 'scan') startScanner();
  else stopScanner();
  if (tab === 'search') {
    renderSearch($('#search-form').q.value);
  }
  if (tab === 'manual' && !$('#food-form').dataset.keep) resetFoodForm();
  delete $('#food-form').dataset.keep;
}

// ---------- Scanner ----------
let scanner = null;
let scanning = false;
let handlingCode = false;

async function startScanner() {
  if (scanning) return;
  const lib = window.__Html5QrcodeLibrary__;
  if (!lib) { $('#scan-status').textContent = 'Scanner kunne ikke indlæses.'; return; }
  const F = lib.Html5QrcodeSupportedFormats;
  scanner ??= new lib.Html5Qrcode('reader', {
    formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E],
    useBarCodeDetectorIfSupported: true,
    verbose: false,
  });
  scanning = true;
  handlingCode = false;
  $('#scan-status').textContent = 'Peg kameraet mod stregkoden';
  try {
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: (w, h) => ({ width: Math.min(w * 0.85, 320), height: Math.min(h * 0.5, 140) }) },
      onScan,
      () => {}
    );
  } catch (err) {
    scanning = false;
    $('#scan-status').textContent = location.protocol === 'https:' || location.hostname === 'localhost'
      ? 'Ingen adgang til kameraet. Tjek tilladelser i Indstillinger → Safari → Kamera.'
      : 'Kameraet kræver HTTPS. Åbn appen via https://';
    console.warn(err);
  }
}

async function stopScanner() {
  if (scanner && scanning) {
    scanning = false;
    try { await scanner.stop(); } catch {}
  }
}

async function onScan(code) {
  if (handlingCode) return;
  handlingCode = true;
  navigator.vibrate?.(50);
  await stopScanner();
  await lookupBarcode(code);
}

$('#barcode-form').onsubmit = async (e) => {
  e.preventDefault();
  const code = e.target.code.value.replace(/\D/g, '');
  e.target.code.value = '';
  e.target.code.blur();
  if (!code) return;
  await stopScanner();
  await lookupBarcode(code);
};

async function lookupBarcode(code) {
  const status = $('#scan-status');
  // Allerede kendt (scannet før eller oprettet selv)?
  const known = Object.values(state.foods).find((f) => f.barcode === code);
  if (known) {
    $('#add-sheet').close();
    return openAmount(known);
  }
  status.textContent = `Slår ${code} op…`;
  try {
    const food = await fetchOFF(code);
    if (food) {
      state.foods[food.id] = food;
      save();
      $('#add-sheet').close();
      return openAmount(food);
    }
    status.textContent = `Varen ${code} blev ikke fundet. Opret den selv:`;
  } catch {
    status.textContent = 'Ingen forbindelse. Opret varen selv:';
  }
  resetFoodForm();
  $('#food-form').barcode.value = code;
  $('#food-form').dataset.keep = '1';
  setTimeout(() => showTab('manual'), 900);
}

// ---------- Open Food Facts ----------
const OFF_FIELDS = 'code,product_name,product_name_da,generic_name_da,brands,nutriments,serving_quantity';

function offToFood(p) {
  const n = p.nutriments || {};
  let kcal = n['energy-kcal_100g'];
  if (kcal == null && n.energy_100g != null) kcal = n.energy_100g / 4.184; // kJ → kcal
  if (kcal == null) return null;
  const name = p.product_name_da || p.product_name || p.generic_name_da;
  if (!name) return null;
  return {
    id: 'off:' + p.code,
    source: 'off',
    barcode: p.code,
    name: name.trim(),
    brand: (p.brands || '').split(',')[0].trim(),
    per100: {
      kcal: num(kcal),
      protein: num(n.proteins_100g),
      carbs: num(n.carbohydrates_100g),
      fat: num(n.fat_100g),
    },
    serving: num(p.serving_quantity) || null,
  };
}

async function fetchOFF(code) {
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('OFF ' + res.status);
  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;
  return offToFood({ ...data.product, code });
}

async function searchOFF(q) {
  const url = 'https://world.openfoodfacts.org/cgi/search.pl?' + new URLSearchParams({
    search_terms: q,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '25',
    tagtype_0: 'countries',
    tag_contains_0: 'contains',
    tag_0: 'denmark',
    fields: OFF_FIELDS,
  });
  const res = await fetch(url);
  if (!res.ok) throw new Error('OFF ' + res.status);
  const data = await res.json();
  return (data.products || []).map(offToFood).filter(Boolean);
}

// ---------- Søgning ----------
let offResults = [];

function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function localSearch(q) {
  const words = normalize(q).split(/\s+/).filter(Boolean);
  // Egne/brugte varer overskriver Frida-rækker med samme id
  const all = [...new Map([...state.frida, ...Object.values(state.foods)].map((f) => [f.id, f])).values()];
  if (!words.length) {
    // Uden søgeord: vis senest brugte
    return Object.values(state.foods)
      .filter((f) => f.lastUsed)
      .sort((a, b) => b.lastUsed - a.lastUsed)
      .slice(0, 20);
  }
  const hits = all.filter((f) => {
    const hay = normalize(f.name + ' ' + (f.brand || ''));
    return words.every((w) => hay.includes(w));
  });
  // Brugte varer først, så navne der starter med søgeordet, så korte navne (mere præcise)
  const starts = (f) => {
    const n = normalize(f.name);
    if (n.split(/[\s,]/)[0] === words[0]) return 0; // "Æble, råt" før "Æblegele"
    return n.startsWith(words[0]) ? 1 : 2;
  };
  hits.sort((a, b) =>
    (b.lastUsed || 0) - (a.lastUsed || 0) || starts(a) - starts(b) || a.name.length - b.name.length);
  return hits.slice(0, 40);
}

function foodRow(f, i) {
  const tag = f.source === 'frida' ? '<span class="tag">Frida</span>'
    : f.source === 'off' ? '<span class="tag">OFF</span>'
    : f.source === 'custom' ? '<span class="tag">Egen</span>' : '';
  return `<li data-pick="${i}">
    <div><div class="name">${esc(f.name)}${tag}</div><div class="sub">${esc(f.brand || f.group || '')}</div></div>
    <div class="kcal">${r0(f.per100.kcal)} kcal<div class="sub">pr. 100 g</div></div>
  </li>`;
}

let shownResults = [];
function renderSearch(q, extra = []) {
  const local = localSearch(q);
  const seen = new Set(local.map((f) => f.id));
  shownResults = [...local, ...extra.filter((f) => !seen.has(f.id))];
  const ul = $('#search-results');
  if (!shownResults.length) {
    ul.innerHTML = `<li class="empty">${q.trim() ? 'Ingen lokale resultater' : 'Søg efter en fødevare'}</li>`;
  } else {
    ul.innerHTML = shownResults.map(foodRow).join('');
  }
  $('#off-search-btn').hidden = !q.trim() || extra.length > 0;
}

let searchTimer;
$('#search-form').q.addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => renderSearch(e.target.value), 150);
});
$('#search-form').onsubmit = (e) => {
  e.preventDefault();
  e.target.q.blur();
  renderSearch(e.target.q.value);
};
$('#off-search-btn').onclick = async () => {
  const q = $('#search-form').q.value.trim();
  if (!q) return;
  const btn = $('#off-search-btn');
  btn.textContent = 'Søger…';
  btn.disabled = true;
  try {
    offResults = await searchOFF(q);
    renderSearch(q, offResults);
    if (!offResults.length) toast('Intet fundet i Open Food Facts');
  } catch {
    toast('Kunne ikke søge – tjek forbindelsen');
  } finally {
    btn.textContent = 'Søg i Open Food Facts';
    btn.disabled = false;
  }
};
$('#search-results').addEventListener('click', (e) => {
  const li = e.target.closest('[data-pick]');
  if (!li) return;
  const food = shownResults[+li.dataset.pick];
  $('#add-sheet').close();
  openAmount(food);
});

// ---------- Opret/rediger fødevare ----------
function resetFoodForm() {
  const f = $('#food-form');
  f.reset();
  f.id.value = '';
  f.querySelector('[type=submit]').textContent = 'Gem fødevare';
  clearOcr();
}

// ---------- Billede af næringsindhold ----------
let ocrUrl = null;
let ocrRun = 0;

function clearOcr() {
  ocrRun++; // ignorér en aflæsning der stadig kører
  $('#ocr-box').hidden = true;
  $('#ocr-text').textContent = '';
  $('#ocr-img').classList.remove('zoom');
  if (ocrUrl) { URL.revokeObjectURL(ocrUrl); ocrUrl = null; }
  $$('#food-form input').forEach((i) => i.classList.remove('ocr-filled', 'ocr-missing'));
}

$('#label-photo').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  clearOcr();
  const run = ocrRun;
  ocrUrl = URL.createObjectURL(file);
  $('#ocr-img').src = ocrUrl;
  $('#ocr-box').hidden = false;
  const status = $('#ocr-status');
  status.classList.remove('warn');
  const btn = $('.photo-btn');
  btn.style.pointerEvents = 'none';
  try {
    const text = await readLabel(file, (msg) => { if (run === ocrRun) status.textContent = msg; });
    if (run !== ocrRun) return;
    $('#ocr-text').textContent = text.trim() || '(ingen tekst fundet)';
    const found = parseNutrition(text);
    const f = $('#food-form');
    for (const m of MACROS) {
      const input = f[m];
      if (found[m] != null) {
        input.value = Math.round(found[m] * 10) / 10;
        input.classList.add('ocr-filled');
      } else {
        input.classList.add('ocr-missing');
      }
    }
    const n = MACROS.filter((m) => found[m] != null).length;
    status.classList.toggle('warn', n < 4);
    status.textContent = n === 0
      ? 'Kunne ikke finde tallene. Prøv et skarpere billede tæt på tabellen – eller skriv dem selv.'
      : n < 4
        ? `Fandt ${n} af 4 værdier. Tjek dem mod billedet og udfyld de stiplede felter.`
        : 'Fandt alle 4 værdier. Tjek dem mod billedet, før du gemmer.';
    if (!f.name.value) f.name.focus({ preventScroll: true });
  } catch (err) {
    if (run !== ocrRun) return;
    console.warn(err);
    status.classList.add('warn');
    status.textContent = 'Aflæsningen fejlede – tjek forbindelsen (første gang skal der hentes data).';
  } finally {
    btn.style.pointerEvents = '';
  }
};

$('#ocr-img').onclick = (e) => e.target.classList.toggle('zoom');
$('#food-form').addEventListener('input', (e) => e.target.classList?.remove('ocr-filled', 'ocr-missing'));

function editFood(food) {
  const f = $('#food-form');
  resetFoodForm();
  f.id.value = food.id;
  f.name.value = food.name;
  f.brand.value = food.brand || '';
  f.barcode.value = food.barcode || '';
  MACROS.forEach((m) => (f[m].value = food.per100[m] ?? ''));
  f.serving.value = food.serving || '';
  f.querySelector('[type=submit]').textContent = 'Gem ændringer';
  f.dataset.keep = '1';
  f.dataset.editOnly = '1';
  $('#add-sheet').showModal();
  showTab('manual');
}

$('#food-form').onsubmit = (e) => {
  e.preventDefault();
  const f = e.target;
  const id = f.id.value || 'custom:' + uid();
  const prev = state.foods[id];
  const food = {
    ...prev,
    id,
    source: prev?.source || 'custom',
    name: f.name.value.trim(),
    brand: f.brand.value.trim(),
    barcode: f.barcode.value.replace(/\D/g, '') || null,
    per100: Object.fromEntries(MACROS.map((m) => [m, num(f[m].value)])),
    serving: num(f.serving.value) || null,
  };
  state.foods[id] = food;
  save();
  const editOnly = f.dataset.editOnly;
  delete f.dataset.editOnly;
  $('#add-sheet').close();
  if (editOnly) {
    toast('Gemt');
    renderSettings();
  } else {
    openAmount(food);
  }
};

// ---------- Mængde-ark ----------
let amountCtx = null;

function openAmount(food, { entry } = {}) {
  amountCtx = { food, entry };
  $('#amount-name').textContent = food.name;
  $('#amount-sub').textContent = [food.brand, `${r0(food.per100.kcal)} kcal pr. 100 g`].filter(Boolean).join(' · ');

  const grams = entry?.grams ?? food.lastGrams ?? food.serving ?? 100;
  $('#grams-input').value = Math.round(grams * 10) / 10;

  const chips = new Set();
  if (food.serving) chips.add(food.serving);
  if (food.lastGrams) chips.add(food.lastGrams);
  [50, 100, 150, 200].forEach((g) => chips.add(g));
  $('#grams-chips').innerHTML = [...chips].slice(0, 6)
    .map((g) => `<button type="button" data-g="${g}">${r1(g)} g${g === food.serving ? ' (portion)' : ''}</button>`).join('');

  $('#meal-select').innerHTML = MEALS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
  $('#meal-select').value = entry?.meal || currentMeal || guessMeal();
  $('#delete-entry').hidden = !entry;
  $('#amount-submit').textContent = entry ? 'Gem' : 'Tilføj';
  updatePreview();
  $('#amount-sheet').showModal();
}

function updatePreview() {
  if (!amountCtx) return;
  const n = nutrients(amountCtx.food, num($('#grams-input').value));
  $('#amount-preview').innerHTML = `
    <div><b>${r0(n.kcal)}</b><span class="muted">kcal</span></div>
    <div><b>${r1(n.protein)}</b><span class="muted">protein</span></div>
    <div><b>${r1(n.carbs)}</b><span class="muted">kulh.</span></div>
    <div><b>${r1(n.fat)}</b><span class="muted">fedt</span></div>`;
}

$('#grams-input').addEventListener('input', updatePreview);
$('#grams-chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-g]');
  if (!b) return;
  $('#grams-input').value = b.dataset.g;
  updatePreview();
});

$('#amount-form').onsubmit = (e) => {
  e.preventDefault();
  const grams = num($('#grams-input').value);
  if (grams <= 0) return toast('Skriv en mængde');
  const { food, entry } = amountCtx;
  const meal = $('#meal-select').value;
  const day = (state.log[state.day] ||= []);
  if (entry) {
    Object.assign(entry, { grams, meal });
  } else {
    // Gem en kopi af varen i indlægget, så gamle dage ikke ændres hvis varen redigeres
    const { lastUsed, lastGrams, ...snapshot } = food;
    day.push({ id: uid(), meal, grams, food: snapshot });
  }
  // Husk varen til "senest brugte"
  state.foods[food.id] = { ...(state.foods[food.id] || food), lastUsed: Date.now(), lastGrams: grams };
  save();
  $('#amount-sheet').close();
  renderDay();
  if (!entry) toast(`${food.name} tilføjet`);
};

$('#delete-entry').onclick = () => {
  const { entry } = amountCtx;
  state.log[state.day] = entries().filter((e) => e.id !== entry.id);
  save();
  $('#amount-sheet').close();
  renderDay();
};

// ---------- Indstillinger ----------
function renderSettings() {
  const f = $('#goals-form');
  MACROS.forEach((m) => (f[m].value = state.goals[m]));
  const foods = Object.values(state.foods).sort((a, b) => a.name.localeCompare(b.name, 'da'));
  $('#my-foods').innerHTML = foods.length
    ? foods.map((food) => `<li data-food="${esc(food.id)}">
        <div><div class="name">${esc(food.name)}</div><div class="sub">${esc(food.brand || '')}</div></div>
        <div class="kcal">${r0(food.per100.kcal)} kcal</div></li>`).join('')
    : '<li class="empty">Ingen endnu</li>';
}

$('#goals-form').onsubmit = (e) => {
  e.preventDefault();
  MACROS.forEach((m) => (state.goals[m] = num(e.target[m].value)));
  save();
  toast('Mål gemt');
};

$('#my-foods').addEventListener('click', (e) => {
  const li = e.target.closest('[data-food]');
  if (li && state.foods[li.dataset.food]) editFood(state.foods[li.dataset.food]);
});

$('#export-btn').onclick = async () => {
  const data = JSON.stringify({ version: 1, exported: new Date().toISOString(), goals: state.goals, log: state.log, foods: state.foods }, null, 2);
  const name = `kcal-backup-${dateKey(new Date())}.json`;
  const file = new File([data], name, { type: 'application/json' });
  // På iPhone virker delingsarket bedst (gem i Filer, send til dig selv osv.)
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (err) { if (err.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

$('#import-file').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.log || !data.foods) throw new Error('format');
    if (!confirm('Erstat alle nuværende data med backuppen?')) return;
    state.goals = data.goals || state.goals;
    state.log = data.log;
    state.foods = data.foods;
    save();
    renderSettings();
    toast('Backup indlæst');
  } catch {
    toast('Filen kunne ikke læses');
  }
};

// ---------- Frida ----------
async function loadFrida() {
  try {
    const res = await fetch('data/frida.json');
    if (!res.ok) return;
    const rows = await res.json();
    state.frida = rows.map((r) => ({
      id: 'frida:' + r.id,
      source: 'frida',
      name: r.name,
      brand: '',
      group: r.group || '',
      per100: { kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat },
      serving: null,
    }));
  } catch {
    // Ingen Frida-data endnu – det er fint
  }
}

// ---------- Start ----------
renderDay();
loadFrida();
// Ny dag ved midnat / når appen åbnes igen
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') renderDay();
});
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
