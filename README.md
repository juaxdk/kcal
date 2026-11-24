# Kcal – dansk kalorietæller

En simpel kalorietæller til eget brug. Den kører som webapp (PWA) og kan lægges på iPhonens hjemmeskærm.

- **Scan stregkoder** med kameraet. Varen slås op i [Open Food Facts](https://world.openfoodfacts.org).
- **Søg i danske råvarer** fra Frida, DTU's fødevaredatabase (1.390 fødevarer).
- **Opret egne varer**, når en stregkode ikke findes. Appen husker dem.
- **Tag et billede af næringsdeklarationen.** Tallene aflæses gratis på telefonen med [Tesseract.js](https://github.com/naptha/tesseract.js) og udfyldes, så du kan tjekke dem, før du gemmer. Billedet sendes ingen steder hen.
  - Billedet læses i op til fire udgaver (kontrast, mod genskin, lys tekst på mørk bund og omvendte farver), så dåser og blanke pakker også kan læses.
  - Du kan trække en firkant om tabellen, så kun den bliver læst.
  - Et energitjek (kcal ≈ 4·protein + 4·kulhydrat + 9·fedt) vælger det bedste resultat og advarer, hvis tallene ikke passer sammen.
- **Påmindelse om stregkoden**, når en ny vare gemmes, så den kan scannes direkte næste gang.
- Dagbog med fire måltider, dagsmål for kcal, protein, kulhydrat og fedt, og eksport/import som backup.

Alt gemmes lokalt på telefonen (localStorage). Der er ingen server og intet login.

## Kør lokalt

Det er rene statiske filer uden byggetrin. Start en vilkårlig webserver i mappen, fx:

```
npx serve .
```

Kameraet kræver HTTPS (eller `localhost`). På iPhone skal appen derfor ligge på en HTTPS-adresse.

## Læg den på iPhone

1. Host mappen med HTTPS, fx gratis på GitHub Pages (Settings → Pages → branch `main`).
2. Åbn adressen i **Safari** → Del-knappen → **Føj til hjemmeskærm**.
3. Åbn appen fra hjemmeskærmen og tillad kameraet første gang du scanner.

Når appen er lagt på hjemmeskærmen, sletter iOS ikke dens data. Tag alligevel en backup en gang imellem (Indstillinger → Eksportér).

## Opdatér Frida-data

Når DTU udgiver en ny version:

1. Hent `FCDB_x.x_Dataset.xlsx` fra https://doi.org/10.11583/DTU.32312844
2. `npm install` og derefter `npm run frida -- sti/til/FCDB_x.x_Dataset.xlsx`
3. Hæv `VERSION` i `sw.js`, så telefonerne henter de nye data.

## Filer

| Fil | Indhold |
|---|---|
| `index.html`, `styles.css`, `app.js` | Selve appen |
| `sw.js`, `manifest.json`, `icons/` | Offline og hjemmeskærm |
| `data/frida.json` | Frida-data, konverteret af `tools/frida-til-json.js` |
| `vendor/html5-qrcode.min.js` | Stregkode-afkoder ([html5-qrcode](https://github.com/mebjas/html5-qrcode) 2.3.8, Apache-2.0). Rettet: `TRY_HARDER` er slået til, så lodrette stregkoder kan læses. Kameraet styres af `app.js`, som afkoder i fuld opløsning. |

## Datakilder

- Frida – Fødevaredatabanken v6.1, DTU Fødevareinstituttet, CC BY 4.0.
- Open Food Facts, ODbL.
