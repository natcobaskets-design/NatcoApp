const CACHE_NAME = 'natco-pwa-v1'
const FIREBASE_VERSION = '11.10.0'
const firebaseConfig = __NATCO_FIREBASE_CONFIG__

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys()
    await Promise.all(cacheNames
      .filter((name) => name.startsWith('natco-pwa-') && name !== CACHE_NAME)
      .map((name) => caches.delete(name)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request)
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME)
          await cache.put(new URL('./', self.registration.scope), response.clone())
        }
        return response
      } catch {
        return await caches.match(new URL('./', self.registration.scope)) ??
          new Response('التطبيق غير متاح دون اتصال بعد. افتحه مرة واحدة أثناء الاتصال بالإنترنت.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
      }
    })())
    return
  }

  if (url.pathname.includes('/assets/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME)
      const cached = await cache.match(request)
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok) await cache.put(request, response.clone())
      return response
    })())
  }
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = new URL(
    event.notification.data?.url || './',
    self.registration.scope,
  ).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if (client.url.startsWith(self.registration.scope) && 'navigate' in client) {
        await client.navigate(targetUrl)
        return client.focus()
      }
    }
    return self.clients.openWindow(targetUrl)
  })())
})

if (
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  firebaseConfig.appId &&
  firebaseConfig.messagingSenderId
) {
  importScripts(
    `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app-compat.js`,
    `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-messaging-compat.js`,
  )

  firebase.initializeApp(firebaseConfig)
  const messaging = firebase.messaging()

  messaging.onBackgroundMessage((payload) => {
    const data = payload.data || {}
    const title = data.title || 'إشعار جديد من ناتكو'
    return self.registration.showNotification(title, {
      body: data.body || 'لديك تحديث جديد في طلب السلة الغذائية.',
      icon: new URL('natco-logo.jpg', self.registration.scope).href,
      badge: new URL('natco-logo.jpg', self.registration.scope).href,
      tag: data.tag || data.orderId || 'natco-notification',
      data: {
        url: data.url || self.registration.scope,
        orderId: data.orderId || '',
      },
    })
  })
}
