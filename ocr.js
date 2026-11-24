// Aflæser en næringsdeklaration fra et billede (OCR med Tesseract.js, kører på telefonen).
// Tesseract hentes først første gang funktionen bruges (~5 MB inkl. dansk sprogdata).

const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

let workerPromise = null;
let progressCb = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Kunne ikke hente tekstgenkendelse'));
    document.head.appendChild(s);
  });
}

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      if (!window.Tesseract) await loadScript(TESS_URL);
      return window.Tesseract.createWorker(['dan', 'eng'], 1, {
        logger: (m) => progressCb?.(m),
      });
    })();
    workerPromise.catch(() => (workerPromise = null)); // prøv igen næste gang
  }
  return workerPromise;
}

// ---------- Billedbehandling ----------
// Dåser og blanke pakker giver lys tekst på mørk/farvet bund, genskin og ujævnt lys.
// Derfor laves flere udgaver af billedet, og den der giver flest tal vinder.

/** Indlæs (evt. beskåret) billede som gråtoner i en passende størrelse. */
async function loadGray(file, crop) {
  const bmp = await createImageBitmap(file);
  const sx = crop ? crop.x * bmp.width : 0;
  const sy = crop ? crop.y * bmp.height : 0;
  const sw = crop ? crop.w * bmp.width : bmp.width;
  const sh = crop ? crop.h * bmp.height : bmp.height;
  // Små tekster forstørres (Tesseract vil gerne have ~30 px høje bogstaver), store skaleres ned
  let scale = Math.min(3, Math.max(0.3, 1800 / Math.max(sw, sh)));
  if (Math.max(sw, sh) * scale > 3000) scale = 3000 / Math.max(sw, sh);
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
  bmp.close?.();
  const d = ctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return { gray, w, h };
}

/** Stræk kontrasten ud fra 2 %- og 98 %-percentilen (robust over for genskin). */
function stretch(gray) {
  const hist = new Uint32Array(256);
  for (const v of gray) hist[v]++;
  const n = gray.length;
  let lo = 0, hi = 255, acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * 0.02) { lo = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= n * 0.02) { hi = i; break; } }
  const k = 255 / Math.max(1, hi - lo);
  return gray.map((v) => (v - lo) * k);
}

/**
 * Lokal tærskel: hver pixel sammenlignes med gennemsnittet omkring den,
 * så skygger og genskin på en buet dåse ikke ødelægger resultatet.
 * dark=true: mørk tekst på lys bund. dark=false: lys tekst på mørk bund.
 */
function adaptive(gray, w, h, dark) {
  const r = Math.max(8, Math.round(Math.min(w, h) / 40)); // vinduets halve bredde
  const C = 12;
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    let row = 0;
    for (let x = 1; x <= w; x++) {
      row += gray[(y - 1) * w + (x - 1)];
      integral[y * (w + 1) + x] = integral[(y - 1) * (w + 1) + x] + row;
    }
  }
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const sum = integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      const v = gray[y * w + x];
      out[y * w + x] = (dark ? v < mean - C : v > mean + C) ? 0 : 255; // tekst bliver altid sort
    }
  }
  return removeLines(out, w, h);
}

/** Fjern tabellens vandrette streger – ellers læses de som "IEEE", "—" o.l. midt i rækkerne. */
function removeLines(bin, w, h) {
  const minRun = Math.round(w * 0.25);
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (bin[y * w + x] !== 0) { x++; continue; }
      let e = x;
      while (e < w && bin[y * w + e] === 0) e++;
      if (e - x >= minRun) bin.fill(255, y * w + x, y * w + e);
      x = e;
    }
  }
  return bin;
}

function toCanvas(gray, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) {
    img.data[i] = img.data[i + 1] = img.data[i + 2] = gray[j];
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

const count = (found) => ['kcal', 'protein', 'carbs', 'fat'].filter((k) => found[k] != null).length;

/**
 * Energitjek: kcal ≈ 4·protein + 4·kulhydrat + 9·fedt.
 * Kostfibre, alkohol og sødemidler giver lidt ekstra, så der er mest slæk opad.
 * Returnerer true/false når alle fire tal findes, ellers null (kan ikke afgøres).
 */
export function energyCheck(f) {
  if (f.kcal == null) return null;
  const known = ['protein', 'carbs', 'fat'].filter((k) => f[k] != null);
  if (!known.length) return null;
  const est = 4 * (f.protein ?? 0) + 4 * (f.carbs ?? 0) + 9 * (f.fat ?? 0);
  const diff = f.kcal - est;
  if (diff < -Math.max(10, f.kcal * 0.12)) return false; // makroerne alene giver for mange kcal
  if (known.length < 3) return null; // mangler tal – kan ikke sige mere
  return diff <= Math.max(25, f.kcal * 0.3);
}

// Point: flest fundne tal, og tal der passer sammen slår tal der ikke gør
const score = (f) => count(f) * 2 + (energyCheck(f) === true ? 3 : energyCheck(f) === false ? -4 : 0);

/**
 * Læser næringsindholdet på et billede.
 * crop: valgfrit udsnit som brøkdele {x, y, w, h} (0–1) af billedet.
 * Returnerer { found, text } – found har de værdier der blev fundet.
 */
export async function analyzeLabel(file, { crop = null, onProgress } = {}) {
  let step = '';
  progressCb = (m) => {
    if (m.status === 'recognizing text') onProgress?.(`${step} ${Math.round(m.progress * 100)}%`);
    else if (/load|initializ/i.test(m.status)) onProgress?.('Henter tekstgenkendelse (kun første gang)…');
  };
  onProgress?.('Forbereder billede…');
  const [worker, { gray, w, h }] = await Promise.all([getWorker(), loadGray(file, crop)]);
  // PSM 6 (én tekstblok) holder tabellens rækker samlet – testet bedst på både hele billeder og udsnit
  await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });

  const base = stretch(gray);
  const variants = [
    ['Læser billedet…', () => base],
    ['Prøver mod genskin…', () => adaptive(base, w, h, true)],
    ['Prøver lys tekst på mørk bund…', () => adaptive(base, w, h, false)],
    ['Prøver omvendte farver…', () => base.map((v) => 255 - v)],
  ];

  const results = [];
  for (const [i, [label, make]] of variants.entries()) {
    step = `${label} (${i + 1}/${variants.length})`;
    onProgress?.(step);
    const { data } = await worker.recognize(toCanvas(make(), w, h));
    const text = data.text || '';
    const found = parseNutrition(text);
    results.push({ found, text });
    if (energyCheck(found)) break; // alle fire tal fundet og de passer sammen – spar tid
  }

  // Kandidater: hvert forsøg for sig, og hvert forsøg suppleret med de andres tal.
  // Den med flest tal der også består energitjekket vinder.
  const candidates = [];
  for (const r of results) {
    candidates.push({ found: r.found, text: r.text });
    const merged = { ...r.found };
    for (const o of results) for (const k of Object.keys(o.found)) merged[k] ??= o.found[k];
    candidates.push({ found: merged, text: r.text });
  }
  candidates.sort((a, b) => score(b.found) - score(a.found));
  const best = candidates[0];
  return { found: best.found, text: best.text, consistent: energyCheck(best.found) };
}

/**
 * Finder kcal, protein, kulhydrat og fedt pr. 100 g i aflæst tekst.
 * Første tal efter et nøgleord bruges, da "pr. 100 g"-kolonnen normalt står først.
 */
export function parseNutrition(raw) {
  const text = String(raw)
    .toLowerCase()
    .replace(/\r/g, '')
    .replace(/(\d[,.]?)o\b/g, (_, d) => d + '0') // typisk OCR-fejl: 1O → 10, 59,O → 59,0
    .replace(/(\d)\s*,\s*(\d)/g, '$1.$2') // 6,9 → 6.9
    .replace(/k\s*j\b/g, 'kj')
    .replace(/k\s*cal/g, 'kcal');
  const out = {};

  // Energi: "1520 kJ / 362 kcal", "362 kcal", "kJ/kcal 1520/362" eller kun kJ
  let m = text.match(/kj\s*\/\s*kcal[^\d]{0,15}(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (m) out.kcal = +m[2];
  if (out.kcal == null && (m = text.match(/(\d+(?:\.\d+)?)\s*kcal/))) out.kcal = +m[1];
  if (out.kcal == null && (m = text.match(/(\d+(?:\.\d+)?)\s*kj/))) out.kcal = Math.round(+m[1] / 4.184);

  const rules = {
    fat: /\b(fedt|fed|fat|matiere grasse)\b/,
    carbs: /(kulhydrat|carbohydrat|kolhydrat|karbohydrat)/,
    protein: /\bprotein/,
  };
  // Underlinjer som "heraf mættede fedtsyrer" / "heraf sukkerarter" skal ikke bruges
  const skip = /heraf|hvoraf|mættede|mættet|sukker|saturat|sugar|of which|umættede|fedtsyre/;

  for (let line of text.split('\n')) {
    // Klip linjen ved "heraf …", så "Fedt 6,9 g heraf mættede 2,1 g" stadig giver 6,9
    const s = line.search(skip);
    if (s >= 0) line = line.slice(0, s);
    for (const [key, re] of Object.entries(rules)) {
      if (out[key] != null) continue;
      const hit = line.match(re);
      if (!hit) continue;
      // "0 g" læses ofte som "Og"/"O g"/"o" – et løst o efter nøgleordet er et nul
      const after = line.slice(hit.index + hit[0].length).replace(/(^|[^a-zæøå\d])o(?=\s*g\b|\s|$)/g, '$10');
      const n = after.match(/(<\s*)?(\d+(?:\.\d+)?)\s*(g\b)?/);
      if (!n) continue;
      let s = n[2];
      // OCR læser ofte "g" som "9": "6,9 g" → "6,99", "10 g" → "109".
      // Mangler "g" og ender tallet på 9 med 2+ decimaler (eller er det > 100), fjernes 9-tallet.
      if (!n[3] && s.endsWith('9') && (/\.\d{2,}$/.test(s) || +s > 100)) s = s.slice(0, -1);
      const v = n[1] ? 0 : +s; // "< 0.5 g" → 0
      if (v <= 100) out[key] = v;
    }
  }
  if (out.kcal != null && (out.kcal < 0 || out.kcal > 950)) delete out.kcal; // urealistisk pr. 100 g (0 er ok: light-sodavand)
  return out;
}
