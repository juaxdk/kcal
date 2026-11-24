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

// Nedskalér, gråtone og mere kontrast – giver mærkbart bedre genkendelse.
async function prepare(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = Math.max(0, Math.min(255, (g - 128) * 1.5 + 128));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Læser teksten på billedet. onProgress(tekst) kaldes undervejs. */
export async function readLabel(file, onProgress) {
  progressCb = (m) => {
    if (m.status === 'recognizing text') onProgress?.(`Læser tekst… ${Math.round(m.progress * 100)}%`);
    else if (/load|initializ/i.test(m.status)) onProgress?.('Henter tekstgenkendelse (kun første gang)…');
  };
  onProgress?.('Forbereder billede…');
  const [worker, canvas] = await Promise.all([getWorker(), prepare(file)]);
  const { data } = await worker.recognize(canvas);
  return data.text || '';
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
    fat: /\b(fedt|fat|matiere grasse)\b/,
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
      const after = line.slice(hit.index + hit[0].length);
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
  if (out.kcal != null && (out.kcal <= 0 || out.kcal > 950)) delete out.kcal; // urealistisk pr. 100 g
  return out;
}
