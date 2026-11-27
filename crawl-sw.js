/* Caches the crawl shell so the page reopens quickly.
   Live stand data and the rest of the site are left to the network. */
var CACHE = "xmas-crawl-1";
var SHELL = [
  "/crawl2026/",
  "/crawl2026/map",
  "/crawl2026-preview-h4k9mq2x/",
  "/crawl2026-preview-h4k9mq2x/map",
  "/css/crawl.css?v=20261127j",
  "/js/crawl.js",
  "/js/crawl-tour.js",
  "/js/crawl-logic.js",
  "/js/crawl-data.js",
  "/js/crawl-install.js",
  "/images/crawl-icon-192.png",
  "/images/crawl-icon-512.png",
  "/images/apple-touch-icon.png",
  "/images/logo.png",
  "/images/favicon-32.png"
];

function crawlPath(path) {
  return path.indexOf("/crawl2026") === 0 ||
    path.indexOf("/css/crawl.css") === 0 ||
    path.indexOf("/js/crawl") === 0 ||
    path.indexOf("/images/crawl-icon-") === 0;
}

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    return cache.addAll(SHELL);
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) {
      return caches.delete(k);
    }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (event) {
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (!crawlPath(url.pathname)) return;
  if (url.pathname.indexOf("/data/") === 0) return;
  event.respondWith(fetch(event.request).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (cache) { cache.put(event.request, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(event.request);
  }));
});
