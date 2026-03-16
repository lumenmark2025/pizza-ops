const CACHE_NAME = 'pizza-ops-shell-v2'
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  )
})

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url)

  if (
    event.request.method !== 'GET' ||
    !['http:', 'https:'].includes(requestUrl.protocol) ||
    requestUrl.origin !== self.location.origin
  ) {
    return
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (!response.ok || response.type === 'opaque') {
            return response
          }

          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
          return response
        })
        .catch(() => cached)

      return cached ?? networkFetch
    }),
  )
})
