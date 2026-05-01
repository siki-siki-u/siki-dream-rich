const https = require('https');

function get(rawUrl, timeoutMs) {
  return new Promise(function(resolve, reject) {
    var parsed;
    try { parsed = new URL(rawUrl); } catch(e) { return reject(e); }
    var opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
      },
    };
    var req = https.get(opts, function(res) {
      // 리다이렉트 처리
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        return get(res.headers.location, timeoutMs).then(resolve).catch(reject);
      }
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 8000, function() { req.destroy(); reject(new Error('timeout')); });
  });
}

function fromRSSXML(body) {
  var videos = [];
  var re = /<entry>([\s\S]*?)<\/entry>/g, m;
  while ((m = re.exec(body)) !== null) {
    var e = m[1];
    var vid = (e.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1]
           || (e.match(/watch\?v=([\w-]{11})/) || [])[1] || '';
    if (!vid) continue;
    var title = ((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '')
      .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/,'$1').trim();
    var pub = ((e.match(/<published>([\s\S]*?)<\/published>/) || [])[1]
           || (e.match(/<updated>([\s\S]*?)<\/updated>/) || [])[1] || '').split('T')[0];
    var desc = ((e.match(/<media:description>([\s\S]*?)<\/media:description>/) || [])[1]
             || (e.match(/<summary[^>]*>([\s\S]*?)<\/summary>/) || [])[1] || '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/,'$1').replace(/<[^>]*>/g,'').slice(0, 300);
    videos.push({ videoId: vid, title, published: pub, desc, thumb: 'https://img.youtube.com/vi/' + vid + '/mqdefault.jpg' });
  }
  // RSS 2.0 fallback
  if (!videos.length) {
    var re2 = /<item>([\s\S]*?)<\/item>/g;
    while ((m = re2.exec(body)) !== null) {
      var e2 = m[1];
      var vid2 = (e2.match(/watch\?v=([\w-]{11})/) || [])[1] || '';
      if (!vid2) continue;
      var title2 = ((e2.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/,'$1').replace(/&amp;/g,'&').trim();
      var pub2 = ((e2.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '').split(' ').slice(0,4).join(' ');
      videos.push({ videoId: vid2, title: title2, published: pub2, desc: '', thumb: 'https://img.youtube.com/vi/' + vid2 + '/mqdefault.jpg' });
    }
  }
  return videos;
}

function fromInvidious(body) {
  var data = JSON.parse(body);
  var list = data.videos || data.latestVideos || [];
  return list.map(function(v) {
    return { videoId: v.videoId || '', title: v.title || '', published: v.publishedText || '', desc: (v.description || '').slice(0, 300), thumb: 'https://img.youtube.com/vi/' + (v.videoId||'') + '/mqdefault.jpg' };
  }).filter(function(v){ return !!v.videoId; });
}

function fromRss2Json(body) {
  var d = JSON.parse(body);
  if (!d.items || !d.items.length) return [];
  return d.items.map(function(item) {
    var vid = (item.link || '').split('v=')[1] || '';
    return { videoId: vid, title: item.title || '', published: (item.pubDate || '').split(' ')[0], desc: (item.description || '').replace(/<[^>]*>/g,'').slice(0,300), thumb: 'https://img.youtube.com/vi/' + vid + '/mqdefault.jpg' };
  }).filter(function(v){ return !!v.videoId; });
}

// 첫 번째 성공한 결과를 반환 (병렬 race)
function raceSuccess(tasks) {
  return new Promise(function(resolve, reject) {
    var failed = 0;
    var settled = false;
    tasks.forEach(function(task) {
      task().then(function(result) {
        if (!settled) { settled = true; resolve(result); }
      }).catch(function() {
        if (++failed === tasks.length && !settled) { reject(new Error('all failed')); }
      });
    });
  });
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  var CH = 'UCwSSqi-s0wcH6pJbH3YPZqQ';
  var errors = [];

  var attempts = [
    // 가장 안정적인 소스 먼저
    { name: 'yt-rss-direct',  url: 'https://www.youtube.com/feeds/videos.xml?channel_id=' + CH, parse: fromRSSXML },
    { name: 'rss2json',       url: 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent('https://www.youtube.com/feeds/videos.xml?channel_id=' + CH), parse: fromRss2Json },
    { name: 'rsshub',         url: 'https://rsshub.app/youtube/channel/' + CH,              parse: fromRSSXML },
    { name: 'rsshub-2',       url: 'https://rsshub.rssforever.com/youtube/channel/' + CH,   parse: fromRSSXML },
    { name: 'invidious-yewtu',  url: 'https://yewtu.be/api/v1/channels/' + CH + '/videos',               parse: fromInvidious },
    { name: 'invidious-jing',   url: 'https://invidious.jing.rocks/api/v1/channels/' + CH + '/videos',   parse: fromInvidious },
    { name: 'invidious-privr',  url: 'https://invidious.privacyredirect.com/api/v1/channels/' + CH + '/videos', parse: fromInvidious },
    { name: 'invidious-art',    url: 'https://yt.artemislena.eu/api/v1/channels/' + CH + '/videos',      parse: fromInvidious },
  ];

  // 배치 1: 가장 빠른 2개 먼저 시도 (병렬)
  var batch1 = attempts.slice(0, 2);
  var batch2 = attempts.slice(2);

  async function tryOne(attempt) {
    var r = await get(attempt.url, 8000);
    if (r.status !== 200) throw new Error(attempt.name + ': HTTP ' + r.status);
    var videos = attempt.parse(r.body);
    if (!videos.length) throw new Error(attempt.name + ': 0 videos');
    return { videos, source: attempt.name };
  }

  try {
    var result = await raceSuccess(batch1.map(function(a){ return function(){ return tryOne(a); }; }));
    return res.json(result);
  } catch(e) {
    errors.push(e.message);
  }

  // 배치 1 전부 실패 → 배치 2 병렬 시도
  try {
    var result2 = await raceSuccess(batch2.map(function(a){ return function(){ return tryOne(a); }; }));
    return res.json(result2);
  } catch(e) {
    errors.push(e.message);
  }

  res.status(500).json({ error: '모든 방법 실패', details: errors });
};
