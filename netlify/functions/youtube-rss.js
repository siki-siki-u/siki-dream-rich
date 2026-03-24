const https = require('https');

function httpsGet(url, redirects) {
  redirects = redirects || 0;
  return new Promise(function(resolve, reject) {
    if (redirects > 5) return reject(new Error('too many redirects'));
    var req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)',
        'Accept': 'application/xml, text/xml, */*',
        'Accept-Encoding': 'identity',
        'Accept-Language': 'ko,en;q=0.9',
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
    req.setTimeout(10000, function() { req.destroy(); reject(new Error('timeout')); });
  });
}

function parseRSS(xml) {
  var videos = [];
  var re = /<entry>([\s\S]*?)<\/entry>/g;
  var m;
  while ((m = re.exec(xml)) !== null) {
    var e = m[1];
    var vid   = (e.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1] || '';
    var title = (e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
    var pub   = (e.match(/<published>([\s\S]*?)<\/published>/) || [])[1] || '';
    var desc  = (e.match(/<media:description>([\s\S]*?)<\/media:description>/) || [])[1] || '';
    if (!vid) continue;
    title = title.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/<!\[CDATA\[|\]\]>/g,'').trim();
    desc  = desc.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').slice(0, 300).trim();
    pub   = pub.split('T')[0];
    videos.push({ videoId: vid, title: title, published: pub, desc: desc, thumb: 'https://img.youtube.com/vi/' + vid + '/mqdefault.jpg' });
  }
  return videos;
}

exports.handler = async function() {
  try {
    var result = await httpsGet('https://www.youtube.com/feeds/videos.xml?channel_id=UC84OTRAO0FMDgMY1u9pbOBg');
    if (result.status !== 200) {
      return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'YouTube 응답 오류: ' + result.status }) };
    }
    var videos = parseRSS(result.body);
    if (!videos.length) {
      return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: '영상 파싱 실패', raw: result.body.slice(0, 300) }) };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ videos: videos })
    };
  } catch (err) {
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: err.message }) };
  }
};
