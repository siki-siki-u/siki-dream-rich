const CACHE_NAME = 'sikijingu-v9';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&family=JetBrains+Mono:wght@400;700&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
];

// Supabase 도메인 — 캐시 제외
function isSupabase(url) {
  return url.includes('.supabase.co') || url.includes('supabase.io');
}

// 정적 자산 확장자
function isStatic(url) {
  return /\.(js|css|woff2?|ttf|png|svg|ico|jpg|jpeg|webp)(\?.*)?$/.test(url);
}

// ── Install: 핵심 정적 자산 사전 캐싱 ──
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(['/index.html']);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// ── Activate: 이전 캐시 정리 ──
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      // 업데이트 배너: 모든 클라이언트에 알림
      return self.clients.matchAll({ type: 'window' }).then(function(clients) {
        clients.forEach(function(c) { c.postMessage({ type: 'SW_UPDATED' }); });
      });
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ── Fetch ──
self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // Supabase, API 라우트, POST → 캐시 완전 제외
  if (isSupabase(url) || url.includes('/api/') || e.request.method !== 'GET') {
    return;
  }

  if (isStatic(url)) {
    // Cache First: 정적 자산
    e.respondWith(
      caches.match(e.request).then(function(cached) {
        if (cached) return cached;
        return fetch(e.request).then(function(res) {
          if (res && res.status === 200) {
            var clone = res.clone();
            caches.open(CACHE_NAME).then(function(c) { c.put(e.request, clone); });
          }
          return res;
        });
      })
    );
  } else {
    // Network First: HTML 및 나머지
    e.respondWith(
      fetch(e.request).then(function(res) {
        if (res && res.status === 200) {
          var clone = res.clone();
          caches.open(CACHE_NAME).then(function(c) { c.put(e.request, clone); });
        }
        return res;
      }).catch(function() {
        return caches.match(e.request).then(function(cached) {
          return cached || caches.match('/index.html');
        });
      })
    );
  }
});
