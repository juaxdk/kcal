// Konverterer Frida-datasættet fra DTU (FCDB_x.x_Dataset.xlsx) til data/frida.json.
//
// Hent datasættet her: https://doi.org/10.11583/DTU.32312844  (licens: CC BY 4.0)
// Kør:  npm install  &&  node tools/frida-til-json.js sti/til/FCDB_6.1_Dataset.xlsx
//
// Vi bruger "deklarations"-værdierne, fordi de er beregnet som på næringsdeklarationen
// på en pakke – så tal fra Frida og fra stregkoder (Open Food Facts) kan sammenlignes.

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

// Frida ParameterID'er (række 4 i arket Data_Table). Første tal foretrækkes, ellers næste.
const PARAMS = {
  kcal: [359, 356],    // Energi, deklaration (kcal) → Energi (kcal)
  protein: [317, 218], // Protein, deklaration → Protein
  carbs: [318, 172],   // Tilgængelig kulhydrat, deklaration → Tilgængelig kulhydrat
  fat: [141],          // Fedt
};

const cell = (v) =>
  v && typeof v === 'object' ? (v.richText ? v.richText.map((t) => t.text).join('') : v.result ?? null) : v;

(async () => {
  const input = process.argv[2];
  if (!input) {
    console.error('Brug: node tools/frida-til-json.js FCDB_x.x_Dataset.xlsx');
    process.exit(1);
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(input);

  // Fødevaregrupper (vises som undertekst i søgningen)
  const groups = new Map();
  const foodSheet = wb.getWorksheet('Food');
  const fHead = foodSheet.getRow(1).values.map(cell);
  const fId = fHead.indexOf('FoodID');
  const fGroup = fHead.indexOf('FødevareGruppe');
  foodSheet.eachRow((row, i) => {
    if (i > 1) groups.set(cell(row.getCell(fId).value), cell(row.getCell(fGroup).value));
  });

  const ws = wb.getWorksheet('Data_Table');
  const paramRow = ws.getRow(4).values.map(cell); // ParameterID pr. kolonne
  const col = {};
  for (const [key, ids] of Object.entries(PARAMS)) {
    col[key] = ids.map((id) => paramRow.indexOf(id)).filter((c) => c > 0);
    if (!col[key].length) throw new Error(`Fandt ikke kolonne for ${key} (${ids})`);
  }

  const out = [];
  ws.eachRow((row, i) => {
    if (i <= 4) return;
    const name = cell(row.getCell(1).value);
    const id = cell(row.getCell(3).value);
    if (!name || id == null) return;
    const val = (key) => {
      for (const c of col[key]) {
        const n = Number(cell(row.getCell(c).value));
        if (Number.isFinite(n)) return Math.round(n * 10) / 10;
      }
      return null;
    };
    const food = { id, name: String(name).trim(), group: groups.get(id) || '' };
    for (const key of Object.keys(PARAMS)) food[key] = val(key);
    if (food.kcal == null) return; // uden energi er rækken ikke brugbar her
    for (const key of ['protein', 'carbs', 'fat']) food[key] ??= 0;
    out.push(food);
  });

  const dest = path.join(__dirname, '..', 'data', 'frida.json');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out));
  console.log(`Skrev ${out.length} fødevarer til ${dest} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`);
})();
