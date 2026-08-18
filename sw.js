// ============================================================================
// Service Worker — HB Performance
// ----------------------------------------------------------------------------
// SOLO Web Push. A propósito NO tiene handler de `fetch` ni cachea nada:
// el sitio es estático y se sirve por GitHub Pages; cachear acá arriesgaría
// servir contenido viejo (stale). Este SW existe únicamente para recibir
// notificaciones push (chat) y manejar el click, incluso con la app cerrada
// (en Android siempre; en iOS solo si se instaló como PWA en la pantalla de inicio).
//
// El payload lo manda la Edge Function `send-push` como JSON:
//   { title, body, url, tag }
// ============================================================================

self.addEventListener('install', (event) => {
  // Activar el SW nuevo enseguida, sin esperar a que se cierren las pestañas viejas.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Tomar control de las páginas ya abiertas.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { title: 'HB Performance', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'HB Performance';
  const options = {
    body: data.body || '',
    icon: '/logo.png',
    badge: '/logo.png',
    tag: data.tag || 'hb-message',
    renotify: true,
    data: { url: data.url || '/app/dashboard.html' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/app/dashboard.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      // Si ya hay una ventana abierta de la app, la enfoco (y navego si puedo).
      for (const w of wins) {
        if ('focus' in w) {
          w.focus();
          if ('navigate' in w) { try { w.navigate(target); } catch (_) { /* ignore */ } }
          return;
        }
      }
      // Si no, abro una nueva.
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
