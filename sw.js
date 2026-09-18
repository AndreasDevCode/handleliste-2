/* Vår Handleliste – service worker
 *
 * Oppgave: gjøre appen installerbar og la den åpne uten nett.
 * Selve synkroniseringen (Firestore) går ALLTID rett til nettet – den
 * mellomlagres aldri her, slik at dere aldri ser gamle lister.
 */

var VERSION = 'handleliste-180920261252';
var SHELL_CACHE = VERSION + '-shell';   // appens egne filer
var VENDOR_CACHE = VERSION + '-vendor'; // firebase-sdk + skrifter

/* Appens egne filer – må alle lykkes for at installasjonen skal fullføres. */
var SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon-32.png',
  './favicon-64.png'
];

/* Firebase-SDK-en. URL-ene har versjonsnummer i seg og endrer seg aldri,
 * så de kan trygt mellomlagres for alltid. Best effort: feiler én av dem
 * (f.eks. dårlig nett akkurat da), skal installasjonen likevel gå gjennom. */
var VENDOR_FILES = [
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js'
];

/* Verter som aldri skal mellomlagres – levende data og innlogging. */
var LIVE_HOSTS = [
  'firestore.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseremoteconfig.googleapis.com'
];

/* Verter som kan mellomlagres på siden av appen. */
var VENDOR_HOSTS = [
  'www.gstatic.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(function (cache) {
        return cache.addAll(SHELL_FILES.map(function (url) {
          return new Request(url, { cache: 'reload' });
        }));
      })
      .then(function () { return caches.open(VENDOR_CACHE); })
      .then(function (cache) {
        return Promise.all(VENDOR_FILES.map(function (url) {
          return fetch(url, { mode: 'cors' })
            .then(function (res) { if (res && res.ok) return cache.put(url, res); })
            .catch(function () { /* hentes ved første bruk i stedet */ });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (key) {
          if (key !== SHELL_CACHE && key !== VENDOR_CACHE) return caches.delete(key);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (event) {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

function networkFirst(request, cacheName, fallbackUrl) {
  return fetch(request)
    .then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(cacheName).then(function (c) { c.put(request, copy); });
      }
      return res;
    })
    .catch(function () {
      return caches.match(request).then(function (hit) {
        return hit || (fallbackUrl ? caches.match(fallbackUrl) : undefined);
      });
    });
}

function cacheFirst(request, cacheName) {
  return caches.match(request).then(function (hit) {
    if (hit) {
      /* Oppdater i bakgrunnen, men svar umiddelbart fra hurtigbufferen. */
      fetch(request).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) {
          caches.open(cacheName).then(function (c) { c.put(request, res); });
        }
      }).catch(function () { /* offline – helt greit */ });
      return hit;
    }
    return fetch(request).then(function (res) {
      if (res && (res.ok || res.type === 'opaque')) {
        var copy = res.clone();
        caches.open(cacheName).then(function (c) { c.put(request, copy); });
      }
      return res;
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url;
  try { url = new URL(request.url); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  /* Levende data: aldri rør. */
  if (LIVE_HOSTS.indexOf(url.hostname) !== -1) return;

  /* Sidelasting: prøv nett først, slik at en ny versjon alltid slår igjennom.
   * Uten nett: server den lagrede appen. */
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE, './index.html'));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  if (VENDOR_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(cacheFirst(request, VENDOR_CACHE));
  }
});
