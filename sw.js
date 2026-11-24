// Gemmer appens egne filer, så den kan åbne uden net.
// Hæv VERSION når filerne ændres, så telefonen henter den nye udgave.
const VERSION = 'kcal-v13';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'ocr.js',
  'manifest.json',
  'vendor/html5-qrcode.min.js',
  'data/frida.json',
  'icons/icon-180.png',
  'icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // API-kald går direkte på nettet
  // Net først (så nye versioner slår igennem), cache som reserve offline
  e.respondWith(
    // no-cache: spørg altid serveren, så telefonens HTTP-cache ikke giver en gammel app.js
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});
