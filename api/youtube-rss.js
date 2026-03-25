const https = require('https');

function get(rawUrl) {
  return new Promise(function(resolve, reject) {
    var parsed;
    try { parsed = new URL(rawUrl); } catch(e) { return reject(e); }
    var opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/xml, */*',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
    };
    var req = https.get(opts, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); });
    });
    req.on('error', reject);
    req.setTimeout(8000, function() { req.destroy(); reject(new Error('timeout')); });
  });
}

function fromInvidious(body) {
  var data = JSON.parse(body);
  var videos = data.videos || data.latestVideos || [];
  return videos.map(function(v) {
    var vid = v.videoId || '';
    return {
      videoId: vid,
      title: v.title || '',
      published: v.publishedText || '',
      desc: (v.description || v.descriptionHtml || '').replace(/<[^>]*>/g, '').slice(0, 300),
      thumb: 'https://img.youtube.com/vi/' + vid + '/mqdefault.jpg',
    };
  }).filter(function(v) { return !!v.videoId; });
}

function fromYoutubeRSS(body) {
  var videos = [];
  var re = /<entry>([\s\S]*?)<\/entry>/g, m;
  while ((m = re.exec(body)) !== null) {
    var e = m[1];
    var vid = (e.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1] || '';
    if (!vid) continue;
    var title = ((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '')
      .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').trim();
    var pub = ((e.match(/<published>([\s\S]*?)<\/published>/) || [])[1] || '').split('T')[0];
    var desc = ((e.match(/<media:description>([\s\S]*?)<\/media:description>/) || [])[1] || '')
      .replace(/<[^>]*>/g,'').slice(0, 300);
    videos.push({ videoId: vid, title, published: pub, desc, thumb: 'https://img.youtube.com/vi/' + vid + '/mqdefault.jpg' });
  }
  return videos;
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  var CH = 'UC84OTRAO0FMDgMY1u9pbOBg';
  var errors = [];

  var attempts = [
    { name: 'invidious-1', url: 'https://inv.tux.pizza/api/v1/channels/' + CH + '/videos?page=1', parse: fromInvidious },
    { name: 'invidious-2', url: 'https://yewtu.be/api/v1/channels/' + CH + '/videos?page=1', parse: fromInvidious },
    { name: 'invidious-3', url: 'https://invidious.private.coffee/api/v1/channels/' + CH + '/videos?page=1', parse: fromInvidious },
    { name: 'invidious-4', url: 'https://iv.datura.network/api/v1/channels/' + CH + '/videos?page=1', parse: fromInvidious },
    { name: 'yt-rss',      url: 'https://www.youtube.com/feeds/videos.xml?channel_id=' + CH, parse: fromYoutubeRSS },
    { name: 'rss2json',    url: 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent('https://www.youtube.com/feeds/videos.xml?channel_id=' + CH), parse: function(b) {
      var d = JSON.parse(b);
      if (!d.items) return [];
      return d.items.map(function(item) {
        var vid = (item.link || '').split('v=')[1] || '';
        return { videoId: vid, title: item.title || '', published: (item.pubDate || '').split(' ')[0], desc: (item.description || '').replace(/<[^>]*>/g,'').slice(0,300), thumb: 'https://img.youtube.com/vi/' + vid + '/mqdefault.jpg' };
      }).filter(function(v){ return !!v.videoId; });
    }},
  ];

  for (var i = 0; i < attempts.length; i++) {
    try {
      var r = await get(attempts[i].url);
      if (r.status === 200) {
        var videos = attempts[i].parse(r.body);
        if (videos.length) return res.json({ videos: videos, source: attempts[i].name });
        errors.push(attempts[i].name + ': 0 videos');
      } else {
        errors.push(attempts[i].name + ': HTTP ' + r.status);
      }
    } catch(e) {
      errors.push(attempts[i].name + ': ' + e.message);
    }
  }

  res.status(500).json({ error: '모든 방법 실패', details: errors });
};
