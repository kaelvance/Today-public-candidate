const ROOT = new URL(self.registration.scope)
const CACHE_PREFIX = `today-v2-static-${ROOT.pathname}-`
const CACHE = `${CACHE_PREFIX}2.0.2`
const atRoot = (path) => new URL(path, ROOT).href
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg'].map(atRoot)
// The web build adds all hashed JS/CSS assets for the first offline reload.
const PRECACHE = [...SHELL, ...(self.TODAY_STATIC_ASSETS || []).map(atRoot)]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                (key.startsWith(CACHE_PREFIX) ||
                  (ROOT.pathname === '/' && key.startsWith('today-v1-'))) &&
                key !== CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    !url.pathname.startsWith(ROOT.pathname) ||
    url.pathname.startsWith('/api/')
  )
    return
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(atRoot('index.html'), copy))
          }
          return response
        })
        .catch(() => caches.match(atRoot('index.html'))),
    )
    return
  }
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        }),
    ),
  )
})
