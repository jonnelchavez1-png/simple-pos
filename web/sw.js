// Service worker: keeps the app working with no internet.
// To release an update, change VERSION (the deploy workflow does this automatically).
const VERSION = 'v1.0.0';
const CACHE = `simple-pos-${VERSION}`;

const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'src/app.js',
  'src/config.js',
  'src/money.js',
  'src/pricing.js',
  'src/reports.js',
  'src/presets.js',
  'src/receipt.js',
  'src/services.js',
  'src/store.js',
  'src/sync.js',
  'src/util.js',
  'src/ui/dom.js',
  'src/ui/expenses.js',
  'src/ui/items.js',
  'src/ui/receiptDialog.js',
  'src/ui/reports.js',
  'src/ui/sell.js',
  'src/ui/settings.js',
  'src/ui/setup.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('simple-pos-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Only the app's own files are cached. Google and everything else go straight to the network.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))),
  );
});
