// Service Worker - Push notifications only (no caching to avoid stale HTML)

self.addEventListener('install', function(e) {
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  // 기존 캐시 전부 삭제 (stale HTML 방지)
  e.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(names.map(function(n) { return caches.delete(n); }));
    }).then(function() {
      return clients.claim();
    })
  );
});

// 캐싱 없이 네트워크 그대로 통과 (stale HTML 방지)
self.addEventListener('fetch', function(e) {
  // no-op
});

// ── Push 알림 수신 ──
self.addEventListener('push', function(e) {
  var data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch (_) {
    data = { title: '📅 경제 지표 알림', body: e.data ? e.data.text() : '' };
  }

  var title = data.title || '📅 경제 지표 알림';
  var options = {
    body:   data.body   || '',
    tag:    data.tag    || 'econ-event',
    data:   { url: data.url || '/?page=market' },
    requireInteraction: false,
    vibrate: [200, 100, 200],
  };

  e.waitUntil(
    self.registration.showNotification(title, options).catch(function(err) {
      return self.registration.showNotification('⚠️ 알림 오류', { body: String(err && err.message || err) });
    })
  );
});

// ── 알림 클릭 → 앱 열기 ──
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var targetUrl = (e.notification.data && e.notification.data.url) || '/';

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if ('focus' in c) {
          c.navigate(targetUrl);
          return c.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
