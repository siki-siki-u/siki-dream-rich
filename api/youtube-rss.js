const https = require('https');

function httpsGet(url, redirects) {
  redirects = redirects || 0;
  return new Promise(function(resolve, reject) {
    if (redirects > 5) return reject(new Error('too many redirects'));
    try {
      var parsed = new URL(url);
      var req = https.get({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': '*/*',
          'Accept-Encoding': 'identity',
        }
      }, function(res) {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303) {
          return resolve(httpsGet(res.headers.location, redirects + 1));
        }
        var chunks = [];
        res.on('data', function(c) { chunks.push(c); });
        res.on('end', function() {
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
        });
      });
      req.on('error', reject);
      req.setTimeout(8000, function() { req.destroy(); reject(new Error('timeout')); });
    } catch(e) { reject(e); }
  });
}

function parseRSS(xml) {
  var videos = [];
  var re = /<entry>([\s\S]*?)<\/entry>/g, m;
  while ((m = re.exec(xml)) !== null) {
    var e = m[1];
    var vid   = (e.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1] || '';
    var title = (e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
    var pub   = (e.match(/<published>([\s\S]*?)<\/published>/) || [])[1] || '';
    var desc  = (e.match(/<media:description>([\s\S]*?)<\/media:description>/) || [])[1] || '';
    if (!vid) continue;
    title = title.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').trim();
    desc  = desc.replace(/<[^>]*>/g,'').slice(0,300).trim();
    videos.push({ videoId: vid, title: title, published: pub.split('T')[0], desc: desc, thumb: 'https://img.youtube.com/vi/'+vid+'/mqdefault.jpg' });
  }
  return videos;
}

function parsePiped(body) {
  var data = JSON.parse(body);
  if (!data.relatedStreams) return [];
  return data.relatedStreams.map(function(s) {
    var vid = (s.url||'').split('v=')[1] || '';
    return { videoId: vid, title: s.title||'', published: s.uploadedDate||'', desc: (s.shortDescription||'').slice(0,300), thumb: s.thumbnail||('https://img.youtube.com/vi/'+vid+'/mqdefault.jpg') };
  }).filter(function(v){ return !!v.videoId; });
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  var errors = [];

  // 방법 1: YouTube RSS 직접
  try {
    var r = await httpsGet('https://www.youtube.com/feeds/videos.xml?channel_id=UC84OTRAO0FMDgMY1u9pbOBg');
    if (r.status === 200) {
      var videos = parseRSS(r.body);
      if (videos.length) return res.json({ videos: videos, source: 'youtube-rss' });
    }
    errors.push('youtube-rss: status ' + r.status);
  } catch(e) { errors.push('youtube-rss: ' + e.message); }

  // 방법 2~4: Piped 인스턴스
  var piped = ['https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de', 'https://api.piped.yt'];
  for (var i = 0; i < piped.length; i++) {
    try {
      var r2 = await httpsGet(piped[i] + '/channel/UC84OTRAO0FMDgMY1u9pbOBg');
      if (r2.status === 200) {
        var videos2 = parsePiped(r2.body);
        if (videos2.length) return res.json({ videos: videos2, source: piped[i] });
      }
      errors.push(piped[i] + ': status ' + r2.status);
    } catch(e) { errors.push(piped[i] + ': ' + e.message); }
  }

  res.status(500).json({ error: '모든 방법 실패', details: errors });
};
