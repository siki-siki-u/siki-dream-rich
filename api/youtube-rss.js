const https = require('https');
const url = require('url');

function get(rawUrl, redirects) {
  redirects = redirects || 0;
  return new Promise(function(resolve, reject) {
    if (redirects > 5) return reject(new Error('too many redirects'));
    var opts = url.parse(rawUrl);
    opts.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': '*/*',
      'Accept-Encoding': 'identity',
    };
    var req = https.get(opts, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        var loc = res.headers.location;
        if (loc.startsWith('/')) loc = opts.protocol + '//' + opts.host + loc;
        return resolve(get(loc, redirects + 1));
      }
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    req.setTimeout(9000, function() { req.destroy(); reject(new Error('timeout')); });
  });
}

function fromRss2Json(body) {
  var data = JSON.parse(body);
  if (data.status !== 'ok' || !data.items) return [];
  return data.items.map(function(item) {
    var vid = (item.link || item.guid || '').split('v=')[1] || '';
    return {
      videoId: vid,
      title: item.title || '',
      published: (item.pubDate || '').split(' ')[0],
      desc: (item.description || '').replace(/<[^>]*>/g, '').slice(0, 300),
      thumb: item.thumbnail || ('https://img.youtube.com/vi/' + vid + '/mqdefault.jpg'),
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
    var title = ((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim();
    var pub   = ((e.match(/<published>([\s\S]*?)<\/published>/) || [])[1] || '').split('T')[0];
    var desc  = ((e.match(/<media:description>([\s\S]*?)<\/media:description>/) || [])[1] || '').replace(/<[^>]*>/g,'').slice(0,300);
    videos.push({ videoId: vid, title: title, published: pub, desc: desc, thumb: 'https://img.youtube.com/vi/' + vid + '/mqdefault.jpg' });
  }
  return videos;
}

function fromPiped(body) {
  var data = JSON.parse(body);
  if (!data.relatedStreams) return [];
  return data.relatedStreams.map(function(s) {
    var vid = (s.url || '').split('v=')[1] || '';
    return { videoId: vid, title: s.title || '', published: s.uploadedDate || '', desc: (s.shortDescription || '').slice(0, 300), thumb: s.thumbnail || ('https://img.youtube.com/vi/' + vid + '/mqdefault.jpg') };
  }).filter(function(v) { return !!v.videoId; });
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  var CH = 'UC84OTRAO0FMDgMY1u9pbOBg';
  var errors = [];
  var attempts = [
    { name: 'rss2json',   fn: function() { return get('https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent('https://www.youtube.com/feeds/videos.xml?channel_id=' + CH)).then(function(r){ return { r:r, parse: fromRss2Json }; }); } },
    { name: 'yt-rss',     fn: function() { return get('https://www.youtube.com/feeds/videos.xml?channel_id=' + CH).then(function(r){ return { r:r, parse: fromYoutubeRSS }; }); } },
    { name: 'piped-1',    fn: function() { return get('https://pipedapi.kavin.rocks/channel/' + CH).then(function(r){ return { r:r, parse: fromPiped }; }); } },
    { name: 'piped-2',    fn: function() { return get('https://pipedapi.adminforge.de/channel/' + CH).then(function(r){ return { r:r, parse: fromPiped }; }); } },
  ];

  for (var i = 0; i < attempts.length; i++) {
    try {
      var result = await attempts[i].fn();
      if (result.r.status === 200) {
        var videos = result.parse(result.r.body);
        if (videos.length) {
          return res.json({ videos: videos, source: attempts[i].name });
        }
        errors.push(attempts[i].name + ': parsed 0 videos');
      } else {
        errors.push(attempts[i].name + ': HTTP ' + result.r.status);
      }
    } catch(e) {
      errors.push(attempts[i].name + ': ' + e.message);
    }
  }

  res.status(500).json({ error: '모든 방법 실패', details: errors });
};
