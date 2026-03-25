const https = require('https');

function get(rawUrl) {
  return new Promise(function(resolve, reject) {
    var parsed;
    try { parsed = new URL(rawUrl); } catch(e) { return reject(e); }
    var opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'application/json, text/xml, application/rss+xml, */*',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
    };
    var req = https.get(opts, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); });
    });
    req.on('error', reject);
    req.setTimeout(9000, function() { req.destroy(); reject(new Error('timeout')); });
  });
}

function fromRSSXML(body) {
  var videos = [];
  // Atom format (YouTube native / RSSHub)
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
  // RSS 2.0 format fallback
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

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  var CH = 'UC84OTRAO0FMDgMY1u9pbOBg';
  var errors = [];

  var attempts = [
    { name: 'rsshub',       url: 'https://rsshub.app/youtube/channel/' + CH,              parse: fromRSSXML },
    { name: 'rsshub-2',     url: 'https://rsshub.rssforever.com/youtube/channel/' + CH,   parse: fromRSSXML },
    { name: 'invidious-jing', url: 'https://invidious.jing.rocks/api/v1/channels/' + CH + '/videos', parse: fromInvidious },
    { name: 'invidious-art',  url: 'https://yt.artemislena.eu/api/v1/channels/' + CH + '/videos',    parse: fromInvidious },
    { name: 'invidious-fdn',  url: 'https://invidious.fdn.fr/api/v1/channels/' + CH + '/videos',     parse: fromInvidious },
    { name: 'yt-rss',       url: 'https://www.youtube.com/feeds/videos.xml?channel_id=' + CH,        parse: fromRSSXML },
    { name: 'rss2json',     url: 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent('https://www.youtube.com/feeds/videos.xml?channel_id=' + CH), parse: function(b) {
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
