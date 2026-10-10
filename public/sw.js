const ROOT = new URL(self.registration.scope)
const CACHE_PREFIX = `today-v2-static-${ROOT.pathname}-`
const CACHE = `${CACHE_PREFIX}2.1.0-${self.TODAY_BUILD_ID || 'local'}`
const atRoot = (path) => new URL(path, ROOT).href
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg'].map(atRoot)
// The web build adds all hashed JS/CSS assets for the first offline reload.
const PRECACHE = [...SHELL, ...(self.TODAY_STATIC_ASSETS || []).map(atRoot)]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const existed = await caches.has(CACHE)
      try {
        await (await caches.open(CACHE)).addAll(PRECACHE)
      } catch (error) {
        // A failed new generation must not displace the previous working cache.
        // Never delete an existing active cache when a same-key retry fails.
        if (!existed) await caches.delete(CACHE)
        throw error
      }
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        // Waiting workers activate only after old controlled pages close. Keep one
        // previous build for hashed assets still requested by an older document.
        const old = keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
        const previous = old.at(-1)
        return Promise.all(
          keys
            .filter(
              (key) =>
                (key.startsWith(CACHE_PREFIX) ||
                  (ROOT.pathname === '/' && key.startsWith('today-v1-'))) &&
                key !== CACHE &&
                key !== previous,
            )
            .map((key) => caches.delete(key)),
        )
      })
      .then(() => self.clients.claim()),
  )
})

async function matchOwnCache(request) {
  const current = await (await caches.open(CACHE)).match(request)
  if (current) return current
  const previous = (await caches.keys()).filter(
    (key) => key.startsWith(CACHE_PREFIX) && key !== CACHE,
  )
  for (const key of previous.reverse()) {
    const cached = await (await caches.open(key)).match(request)
    if (cached) return cached
  }
}

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
        .catch(() => matchOwnCache(atRoot('index.html'))),
    )
    return
  }
  event.respondWith(
    matchOwnCache(request).then(
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
