// Kcal – en simpel dansk kalorietæller.
// Data gemmes i localStorage på telefonen. Stregkoder slås op i Open Food Facts,
// råvarer kan søges i Frida (DTU), hvis data/frida.json findes.

import { analyzeLabel } from './ocr.js';

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
// Til inputfelter: dansk komma, ingen tusindtalsseparator, tomt for manglende værdi
const fmt = (n) => (n == null || n === '' || !Number.isFinite(+n) ? '' : String(Math.round(n * 10) / 10).replace('.', ','));
const isNum = (v) => /^\s*\d+([.,]\d+)?\s*$/.test(v);
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function nutrients(food, grams) {
  const f = grams / 100;
  return Object.fromEntries(MACROS.map((m) => [m, (food.per100[m] || 0) * f]));
}

// Drikkevarer (food.unit === 'ml'): mængden gemmes stadig i "grams"-feltet, men som ml,
// og næringsindholdet er pr. 100 ml. Vises i ml, og fra 1 liter og op i liter.
const isDrink = (food) => food?.unit === 'ml';
function amountText(food, amount) {
  if (!isDrink(food)) return `${r1(amount)} g`;
  return amount >= 1000 ? `${r1(amount / 1000)} l` : `${r1(amount)} ml`;
}
const per100Text = (food) => (isDrink(food) ? 'pr. 100 ml' : 'pr. 100 g');
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
          <div><div class="name">${esc(e.food.name)}</div><div class="sub">${amountText(e.food, e.grams)}${e.food.brand ? ' · ' + esc(e.food.brand) : ''}</div></div>
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

$('#add-sheet').addEventListener('close', () => { stopScanner(); stopFormScan(); });

$$('#add-sheet .seg button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

function showTab(tab) {
  currentTab = tab;
  store.set('lastTab', tab === 'manual' ? 'scan' : tab);
  $$('#add-sheet .seg button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('#add-sheet .tab').forEach((t) => (t.hidden = t.dataset.tab !== tab));
  stopFormScan();
  if (tab === 'scan') startScanner();
  else stopScanner();
  if (tab === 'search') {
    renderSearch($('#search-form').q.value);
  }
  if (tab === 'manual' && !$('#food-form').dataset.keep) resetFoodForm();
  delete $('#food-form').dataset.keep;
}

// ---------- Stregkodescanner ----------
// Kameraet styres af appen selv: html5-qrcode skalerer kamerabilledet ned til
// scanfeltets størrelse på skærmen (~300 px) og mister skarpheden. Her afkodes
// midten af kamerabilledet i fuld opløsning, skiftevis lige og drejet 90°
// (afkoderen er markant bedre til den ene retning). Biblioteket bruges kun til at afkode.

let decoder = null;
function getDecoder() {
  const lib = window.__Html5QrcodeLibrary__;
  if (!lib) return null;
  decoder ??= makeScanner(lib, 'file-reader').qrcode;
  return decoder;
}

/** Tegn et udsnit af et billede/video på et lærred, evt. drejet 90°, og prøv at afkode det. */
async function decodeRegion(source, sx, sy, sw, sh, maxSize, turn, robust = false) {
  const scale = Math.min(1, maxSize / Math.max(sw, sh));
  const w = Math.round(sw * scale), h = Math.round(sh * scale);
  const canvas = document.createElement('canvas');
  canvas.width = turn ? h : w;
  canvas.height = turn ? w : h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (turn) { ctx.translate(h, 0); ctx.rotate(Math.PI / 2); }
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
  try {
    // "robust" prøver flere varianter (bruges til fotos); live-kameraet bruger den hurtige
    const dec = getDecoder();
    const res = await (robust ? dec.decodeRobustlyAsync(canvas) : dec.decodeAsync(canvas));
    return /^\d{8,14}$/.test(res?.text) ? res.text : null;
  } catch {
    return null;
  }
}

function createCameraScanner(container) {
  let stream = null, timer = null, running = false, frame = 0;
  const api = {
    get running() { return running; },
    async start(onCode) {
      if (running) return;
      if (!getDecoder()) throw new Error('Scanner kunne ikke indlæses');
      running = true;
      frame = 0;
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      if (!running) { s.getTracks().forEach((t) => t.stop()); return; } // stoppet mens vi ventede
      stream = s;
      const video = document.createElement('video');
      video.setAttribute('playsinline', '');
      video.muted = true;
      video.srcObject = stream;
      const guide = document.createElement('div');
      guide.className = 'scan-guide';
      container.replaceChildren(video, guide);
      await video.play();
      let last = null, lastAt = 0;
      const tick = async () => {
        if (!running) return;
        const vw = video.videoWidth, vh = video.videoHeight;
        if (vw && vh) {
          // Midterste 80 % – svarer til den hvide ramme på skærmen
          const sw = vw * 0.8, sh = vh * 0.8;
          const code = await decodeRegion(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 1100, frame++ % 2 === 1);
          // Samme kode skal læses to gange inden for 1,5 s – så slipper falske fund fra støj ikke igennem
          if (code && running) {
            if (code === last && Date.now() - lastAt < 1500) {
              api.stop();
              onCode(code);
              return;
            }
            last = code;
            lastAt = Date.now();
          }
        }
        if (running) timer = setTimeout(tick, 60);
      };
      tick();
    },
    stop() {
      running = false;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      container.replaceChildren();
    },
  };
  return api;
}

const scanner = createCameraScanner($('#reader'));

async function startScanner() {
  if (scanner.running) return;
  $('#scan-status').textContent = 'Peg kameraet mod stregkoden';
  try {
    await scanner.start(onScan);
  } catch (err) {
    scanner.stop();
    $('#scan-status').textContent = cameraError();
    console.warn(err);
  }
}

/**
 * Find en stregkode på et foto.
 * Afkoderen finder sjældent en stregkode der kun fylder lidt af et stort foto,
 * så ud over hele billedet prøves midten og et gitter af overlappende udsnit.
 */
async function decodeBarcodePhoto(file) {
  if (!getDecoder()) return null;
  const bmp = await createImageBitmap(file);
  const W = bmp.width, H = bmp.height;
  // Udsnit som [x, y, bredde, højde] i brøkdele af billedet – de mest sandsynlige først
  const regions = [[0, 0, 1, 1], [0.2, 0.2, 0.6, 0.6]];
  for (const y of [0, 0.25, 0.5]) for (const x of [0, 0.25, 0.5]) regions.push([x, y, 0.5, 0.5]);
  // 12–13 cifre (EAN-13/UPC-A, som næsten alle danske varer har) godtages med det samme.
  // 8 cifre opstår lettere ved et tilfælde af støj, så de skal findes mindst to steder.
  const short = new Map();
  try {
    for (const [rx, ry, rw, rh] of regions) {
      // Udsnittet prøves både som det er og drejet 90° – afkoderen er bedst til den ene retning
      for (const turn of [false, true]) {
        const code = await decodeRegion(bmp, rx * W, ry * H, rw * W, rh * H, 2000, turn, true);
        if (!code) continue;
        if (code.length >= 12) return code;
        short.set(code, (short.get(code) || 0) + 1);
        if (short.get(code) >= 2) return code;
      }
    }
  } finally {
    bmp.close?.();
  }
  return null;
}

$('#barcode-photo').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  await stopScanner();
  const status = $('#scan-status');
  status.textContent = 'Leder efter stregkoden på billedet…';
  const code = await decodeBarcodePhoto(file).catch(() => null);
  if (code) await lookupBarcode(code);
  else status.textContent = 'Fandt ingen stregkode på billedet. Tag det tættere på, eller skriv tallene under stregkoden.';
};

function makeScanner(lib, elementId) {
  const F = lib.Html5QrcodeSupportedFormats;
  return new lib.Html5Qrcode(elementId, {
    formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E],
    useBarCodeDetectorIfSupported: true,
    verbose: false,
  });
}

function cameraError() {
  return location.protocol === 'https:' || location.hostname === 'localhost'
    ? 'Ingen adgang til kameraet. Tjek tilladelser i Indstillinger → Safari → Kamera.'
    : 'Kameraet kræver HTTPS. Åbn appen via https://';
}

// ---------- Scan stregkode ind i en ny vare ----------
const formScanner = createCameraScanner($('#form-reader'));
let saveAfterScan = false;

function formScanStatus(msg, cls = '') {
  const el = $('#form-scan-status');
  el.hidden = !msg;
  el.textContent = msg || '';
  el.className = 'muted ' + cls;
}

async function startFormScan() {
  if (formScanner.running) return stopFormScan(); // knappen virker også som "stop"
  stopScanner(); // kun ét kamera ad gangen
  $('#form-reader').hidden = false;
  $('#scan-barcode-btn').textContent = 'Stop';
  formScanStatus('Peg kameraet mod stregkoden på pakken');
  $('#form-reader').scrollIntoView({ behavior: 'smooth', block: 'center' });
  try {
    await formScanner.start(onFormScan);
  } catch (err) {
    console.warn(err);
    stopFormScan();
    formScanStatus(cameraError(), 'warn');
  }
}

function stopFormScan() {
  formScanner.stop();
  $('#form-reader').hidden = true;
  $('#scan-barcode-btn').textContent = '📷 Scan';
}

function onFormScan(code) {
  navigator.vibrate?.(50);
  stopFormScan();
  setFormBarcode(code);
}

$('#form-barcode-photo').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  await stopFormScan();
  formScanStatus('Leder efter stregkoden på billedet…');
  const code = await decodeBarcodePhoto(file).catch(() => null);
  if (code) setFormBarcode(code);
  else formScanStatus('Fandt ingen stregkode på billedet. Tag det tættere på, eller skriv tallene.', 'warn');
};

function setFormBarcode(code) {
  const f = $('#food-form');
  f.barcode.value = code;
  f.barcode.classList.remove('ocr-missing');
  $('#barcode-reminder').hidden = true;
  const other = Object.values(state.foods).find((x) => x.barcode === code && x.id !== f.id.value);
  if (other) formScanStatus(`✓ ${code} – bruges allerede af "${other.name}" og flyttes til denne vare.`, 'warn');
  else formScanStatus(`✓ Stregkode ${code} tilføjet`, 'ok');
  if (saveAfterScan) {
    saveAfterScan = false;
    f.requestSubmit();
  }
}

$('#scan-barcode-btn').onclick = () => { saveAfterScan = false; startFormScan(); };
$('#reminder-scan').onclick = () => { saveAfterScan = true; startFormScan(); };
$('#reminder-skip').onclick = () => {
  $('#food-form').dataset.skipBarcode = '1';
  $('#food-form').requestSubmit();
};
$('#food-form').barcode.addEventListener('input', () => { $('#barcode-reminder').hidden = true; });

function stopScanner() {
  scanner.stop();
}

async function onScan(code) {
  navigator.vibrate?.(50);
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
const OFF_FIELDS = 'code,product_name,product_name_da,generic_name_da,brands,nutriments,serving_quantity,serving_quantity_unit,quantity,nutrition_data_per,categories_tags';

// Genkender drikkevarer på navnet, når der ikke står ml/cl/liter nogen steder
const DRINK_WORDS = /(?<!\p{L})(monster|red ?bull|cult|faxe|kondi|cola|coca|pepsi|fanta|sprite|squash|cocio|tuborg|carlsberg|sodavand|danskvand|læskedrik|energidrik|energy|juice|saft|smoothie|iste|ice ?tea|limonade|lemonade|øl|pilsner|cider|vin|vand|mælk|drik|drink|kaffe|latte|cappuccino|kakao|shake)(?!\p{L})/iu;
const NOT_DRINK_WORDS = /bar(?!\p{L})|chokolade|pulver|chips|slik|gummi|kiks|kage|bønner/iu;
const looksLikeDrink = (s) => DRINK_WORDS.test(s) && !NOT_DRINK_WORDS.test(s);

// Indlæg i dagbogen har en kopi af varen. Er varen siden blevet en drikkevare,
// vises indlægget også i ml (mængden er den samme, da 1 g ≈ 1 ml).
function syncEntryUnits() {
  let changed = false;
  for (const day of Object.values(state.log)) {
    for (const e of day) {
      if (e.food.unit == null && isDrink(state.foods[e.food.id])) {
        e.food.unit = 'ml';
        changed = true;
      }
    }
  }
  if (changed) {
    save();
    renderDay();
  }
}

// Varer gemt før cl/liter fandtes: genkend drikkevarer på navnet, og slå scannede varer op igen
async function upgradeOldFoods() {
  // Også varer der kun findes i dagbogen (fx slettet fra "mine varer")
  for (const day of Object.values(state.log)) {
    for (const e of day) {
      if (e.food.unit == null && !state.foods[e.food.id] && looksLikeDrink(e.food.name + ' ' + (e.food.brand || ''))) {
        e.food.unit = 'ml';
      }
    }
  }
  const old = Object.values(state.foods).filter((f) => f.source !== 'frida' && f.unit == null && !f.unitChecked);
  for (const f of old) {
    if (looksLikeDrink(f.name + ' ' + (f.brand || ''))) f.unit = 'ml';
    if (f.source !== 'off' || f.unit) f.unitChecked = true;
  }
  save();
  syncEntryUnits();
  for (const f of old.filter((f) => !f.unitChecked && f.barcode)) {
    try {
      const fresh = await fetchOFF(f.barcode);
      const cur = state.foods[f.id];
      if (!cur || cur.unitChecked) continue; // ændret imens
      if (fresh?.unit) {
        cur.unit = fresh.unit;
        if (!cur.serving) cur.serving = fresh.serving;
      }
      cur.unitChecked = true;
      save();
      syncEntryUnits();
    } catch {
      return; // intet net – prøv igen næste gang appen åbnes
    }
  }
}

// "33 cl", "1,5 L", "500ml" → ml (null hvis det ikke er en væskemængde)
function parseVolume(s) {
  const m = String(s || '').match(/(\d+(?:[.,]\d+)?)\s*(ml|cl|dl|l|liter|litre)\b/i);
  if (!m) return null;
  const factor = { ml: 1, cl: 10, dl: 100 }[m[2].toLowerCase()] || 1000;
  return num(m[1]) * factor;
}

function offToFood(p) {
  const n = p.nutriments || {};
  let kcal = n['energy-kcal_100g'];
  if (kcal == null && n.energy_100g != null) kcal = n.energy_100g / 4.184; // kJ → kcal
  if (kcal == null) return null;
  const name = p.product_name_da || p.product_name || p.generic_name_da;
  if (!name) return null;
  const volume = parseVolume(p.quantity);
  const byWeight = /\d\s*(g|kg)\b/i.test(p.quantity || ''); // fx kaffebønner "500 g"
  const drink = p.nutrition_data_per === '100ml' || p.serving_quantity_unit === 'ml' || volume != null
    || (!byWeight && ((p.categories_tags || []).includes('en:beverages') || looksLikeDrink(name + ' ' + (p.brands || ''))));
  let serving = num(p.serving_quantity) || null;
  // Dåser og flasker uden angivet portion: brug hele indholdet som portion (op til 1 liter)
  if (drink && !serving && volume && volume <= 1000) serving = volume;
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
    serving,
    ...(drink && { unit: 'ml' }),
    unitChecked: true,
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
    <div class="kcal">${r0(f.per100.kcal)} kcal<div class="sub">${per100Text(f)}</div></div>
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
  delete f.dataset.skipBarcode;
  saveAfterScan = false;
  $('#barcode-reminder').hidden = true;
  formScanStatus('');
  stopFormScan();
  clearOcr();
  delete f.drink.dataset.touched;
  updateDrinkLabels();
}

function updateDrinkLabels() {
  const drink = $('#food-form').drink.checked;
  $('#per100-note').textContent = `Pr. 100 ${drink ? 'ml' : 'g'} (står på bagsiden af pakken)`;
  $('#serving-label').textContent = `Portion i ${drink ? 'ml' : 'gram'} (valgfri)`;
}
$('#food-form').drink.addEventListener('change', (e) => {
  e.target.dataset.touched = '1';
  updateDrinkLabels();
});
// Sæt selv fluebenet ud fra navnet (fx "Faxe Kondi"), indtil brugeren har rørt det
$('#food-form').addEventListener('input', (e) => {
  const f = e.currentTarget;
  if ((e.target === f.name || e.target === f.brand) && !f.drink.dataset.touched) {
    f.drink.checked = looksLikeDrink(f.name.value + ' ' + f.brand.value);
    updateDrinkLabels();
  }
});

// ---------- Billede af næringsindhold ----------
let ocrUrl = null;
let ocrRun = 0;

let ocrFile = null;
let ocrBusy = false;
let crop = null; // markeret udsnit som brøkdele af billedet

function clearOcr() {
  ocrRun++; // ignorér en aflæsning der stadig kører
  ocrBusy = false;
  ocrFile = null;
  setCrop(null);
  $('#ocr-box').hidden = true;
  $('#ocr-text').textContent = '';
  if (ocrUrl) { URL.revokeObjectURL(ocrUrl); ocrUrl = null; }
  $$('#food-form input').forEach((i) => i.classList.remove('ocr-filled', 'ocr-missing'));
}

$('#label-photo').onchange = (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  clearOcr();
  ocrFile = file;
  ocrUrl = URL.createObjectURL(file);
  $('#ocr-img').src = ocrUrl;
  $('#ocr-box').hidden = false;
  runOcr();
};

async function runOcr() {
  if (!ocrFile || ocrBusy) return;
  const run = ++ocrRun;
  ocrBusy = true;
  const status = $('#ocr-status');
  status.classList.remove('warn');
  $('.photo-btn').style.pointerEvents = 'none';
  $('#ocr-reread').disabled = true;
  try {
    const { found, text, consistent } = await analyzeLabel(ocrFile, {
      crop,
      onProgress: (msg) => { if (run === ocrRun) status.textContent = msg; },
    });
    if (run !== ocrRun) return;
    $('#ocr-text').textContent = text.trim() || '(ingen tekst fundet)';
    const f = $('#food-form');
    // "Pr. 100 ml" på etiketten → drikkevare (OCR læser tit "l" som "1")
    if (/100\s*m[l1I|]\b/.test(text)) {
      f.drink.checked = true;
      f.drink.dataset.touched = '1';
      updateDrinkLabels();
    }
    for (const m of MACROS) {
      const input = f[m];
      input.classList.remove('ocr-filled', 'ocr-missing');
      if (found[m] != null) {
        input.value = fmt(found[m]);
        input.classList.add('ocr-filled');
      } else if (!input.value) {
        input.classList.add('ocr-missing');
      }
    }
    const n = MACROS.filter((m) => found[m] != null).length;
    const tip = crop ? '' : ' Tip: træk en firkant om tabellen på billedet og tryk "Læs markeringen".';
    status.classList.toggle('warn', n < 4 || consistent === false);
    status.textContent = consistent === false
      ? '⚠️ Tallene passer ikke sammen (kcal stemmer ikke med protein, kulhydrat og fedt). Tjek dem ekstra godt mod billedet.' + tip
      : n === 0
      ? 'Kunne ikke finde tallene.' + (tip || ' Prøv et skarpere billede tæt på tabellen – eller skriv dem selv.')
      : n < 4
        ? `Fandt ${n} af 4 værdier. Tjek dem mod billedet og udfyld de stiplede felter.` + tip
        : 'Fandt alle 4 værdier. Tjek dem mod billedet, før du gemmer.';
  } catch (err) {
    if (run !== ocrRun) return;
    console.warn(err);
    status.classList.add('warn');
    status.textContent = 'Aflæsningen fejlede – tjek forbindelsen (første gang skal der hentes data).';
  } finally {
    if (run === ocrRun) ocrBusy = false;
    $('.photo-btn').style.pointerEvents = '';
    $('#ocr-reread').disabled = false;
  }
}

// ---------- Markér tabellen på billedet ----------
function setCrop(c) {
  crop = c;
  const rect = $('#crop-rect');
  rect.hidden = !c;
  $('#ocr-reread').hidden = !c;
  if (c) Object.assign(rect.style, { left: c.x * 100 + '%', top: c.y * 100 + '%', width: c.w * 100 + '%', height: c.h * 100 + '%' });
}

(() => {
  const frame = $('#ocr-frame');
  let start = null;
  const pos = (e) => {
    const r = frame.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const rectFrom = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  frame.addEventListener('pointerdown', (e) => {
    start = pos(e);
    frame.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  frame.addEventListener('pointermove', (e) => {
    if (!start) return;
    const c = rectFrom(start, pos(e));
    crop = null; // først gyldig når fingeren slippes
    const rect = $('#crop-rect');
    rect.hidden = false;
    Object.assign(rect.style, { left: c.x * 100 + '%', top: c.y * 100 + '%', width: c.w * 100 + '%', height: c.h * 100 + '%' });
  });
  const end = (e) => {
    if (!start) return;
    const c = rectFrom(start, pos(e));
    start = null;
    setCrop(c.w > 0.05 && c.h > 0.05 ? c : null); // et kort tryk fjerner markeringen
  };
  frame.addEventListener('pointerup', end);
  frame.addEventListener('pointercancel', () => { start = null; setCrop(crop); });
})();

$('#ocr-reread').onclick = () => runOcr();
$('#food-form').addEventListener('input', (e) => e.target.classList?.remove('ocr-filled', 'ocr-missing'));

function editFood(food) {
  const f = $('#food-form');
  resetFoodForm();
  f.id.value = food.id;
  f.name.value = food.name;
  f.brand.value = food.brand || '';
  f.barcode.value = food.barcode || '';
  MACROS.forEach((m) => (f[m].value = fmt(food.per100[m])));
  f.drink.checked = isDrink(food);
  f.drink.dataset.touched = '1';
  f.serving.value = food.serving ? fmt(food.serving) : '';
  updateDrinkLabels();
  f.querySelector('[type=submit]').textContent = 'Gem ændringer';
  f.dataset.keep = '1';
  f.dataset.editOnly = '1';
  $('#add-sheet').showModal();
  showTab('manual');
}

$('#food-form').onsubmit = (e) => {
  e.preventDefault();
  const f = e.target;
  // Egen validering (Safari på iPhone blokerer ellers stille uden at sige hvorfor)
  const bad = [];
  if (!f.name.value.trim()) bad.push(f.name);
  if (!isNum(f.kcal.value)) bad.push(f.kcal);
  for (const k of ['protein', 'carbs', 'fat', 'serving']) {
    if (f[k].value.trim() && !isNum(f[k].value)) bad.push(f[k]);
  }
  if (bad.length) {
    bad.forEach((i) => i.classList.add('ocr-missing'));
    bad[0].focus();
    toast(bad[0] === f.name ? 'Skriv et navn på varen' : 'Tjek de markerede tal');
    return;
  }
  // Påmindelse: uden stregkode kan varen ikke scannes næste gang
  if (!f.barcode.value.replace(/\D/g, '') && !f.dataset.skipBarcode) {
    const r = $('#barcode-reminder');
    r.hidden = false;
    r.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  delete f.dataset.skipBarcode;
  const id = f.id.value || 'custom:' + uid();
  const prev = state.foods[id];
  const unit = f.drink.checked ? 'ml' : undefined;
  const food = {
    ...prev,
    unit,
    unitChecked: true, // brugerens eget valg – må ikke ændres automatisk
    id,
    source: prev?.source || 'custom',
    name: f.name.value.trim(),
    brand: f.brand.value.trim(),
    barcode: f.barcode.value.replace(/\D/g, '') || null,
    per100: Object.fromEntries(MACROS.map((m) => [m, num(f[m].value)])),
    serving: num(f.serving.value) || null,
  };
  if (!unit) delete food.unit;
  // Én stregkode = én vare: den nye/redigerede vare overtager stregkoden
  if (food.barcode) {
    for (const o of Object.values(state.foods)) if (o.id !== id && o.barcode === food.barcode) o.barcode = null;
  }
  state.foods[id] = food;
  save();
  syncEntryUnits();
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
  $('#amount-sub').textContent = [food.brand, `${r0(food.per100.kcal)} kcal ${per100Text(food)}`].filter(Boolean).join(' · ');
  $('#amount-unit').textContent = isDrink(food) ? 'ml' : 'gram';

  const grams = entry?.grams ?? food.lastGrams ?? food.serving ?? (isDrink(food) ? 250 : 100);
  $('#grams-input').value = fmt(grams);

  const chips = new Set();
  if (food.serving) chips.add(food.serving);
  if (food.lastGrams) chips.add(food.lastGrams);
  (isDrink(food) ? [250, 330, 500, 1000] : [50, 100, 150, 200]).forEach((g) => chips.add(g));
  $('#grams-chips').innerHTML = [...chips].slice(0, 6)
    .map((g) => `<button type="button" data-g="${g}">${amountText(food, g)}${g === food.serving ? ' (portion)' : ''}</button>`).join('');

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
  $('#grams-input').value = fmt(+b.dataset.g);
  updatePreview();
});

$('#amount-form').onsubmit = (e) => {
  e.preventDefault();
  const { food, entry } = amountCtx;
  const grams = num($('#grams-input').value);
  if (grams <= 0) return toast('Skriv en mængde');
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
  MACROS.forEach((m) => (f[m].value = fmt(state.goals[m])));
  // Kun varer brugeren selv har oprettet – ikke dem fra Open Food Facts eller Frida
  const foods = Object.values(state.foods)
    .filter((f) => f.source === 'custom')
    .sort((a, b) => a.name.localeCompare(b.name, 'da'));
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
const FRIDA_DRINK_GROUPS = new Set([
  'Vand og mineralvand', 'Drikkevand', 'Kaffe, te og kakao', 'Andre drikkevarer',
  'Frugtjuice, frugtsaft og smoothies', 'Bærjuice og bærsaft', 'Grøntsagsjuice',
  'Øl og andre maltdrikke', 'Cider', 'Vine', 'Hedvine', 'Spiritus', 'Likør',
]);
// Drikkevarer måles i ml – men ikke pulver, kaffebønner og teblade i de samme grupper
function fridaIsDrink(r) {
  if (/pulver|bønne|blade|yoghurt|tykmælk|is\b/i.test(r.name)) return false;
  return FRIDA_DRINK_GROUPS.has(r.group) || /(mælk|drik|kefir|milkshake)\b/i.test(r.name);
}

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
      ...(fridaIsDrink(r) && { unit: 'ml' }),
    }));
    // Tidligere brugte Frida-drikkevarer (gemt før cl/liter fandtes) får også enheden
    const drinks = new Set(state.frida.filter(isDrink).map((f) => f.id));
    let changed = false;
    for (const f of Object.values(state.foods)) {
      if (f.source === 'frida' && f.unit == null && drinks.has(f.id)) {
        f.unit = 'ml'; // lastGrams kan bruges direkte: 1 g ≈ 1 ml
        changed = true;
      }
    }
    if (changed) save();
    syncEntryUnits();
  } catch {
    // Ingen Frida-data endnu – det er fint
  }
}

// ---------- Start ----------
// Indbyggede app-browsere (Messenger, Facebook, Instagram, TikTok …) giver ofte ikke adgang til kameraet
if (/FBAN|FBAV|FB_IAB|Messenger|Instagram|TikTok|Snapchat|LinkedInApp|GSA\//i.test(navigator.userAgent)) {
  $('#inapp-warning').hidden = false;
}
renderDay();
loadFrida();
upgradeOldFoods();
// Ny dag ved midnat / når appen åbnes igen
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') renderDay();
});
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
