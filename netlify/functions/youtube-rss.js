const https = require('https');

function get(url, redirects) {
  redirects = redirects || 0;
  return new Promise(function(resolve, reject) {
    if(redirects > 5) return reject(new Error('too many redirects'));
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, function(res) {
      if(res.statusCode === 301 || res.statusCode === 302) {
        return resolve(get(res.headers.location, redirects + 1));
      }
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() { resolve({ status: res.statusCode, body: data }); });
    }).on('error', reject);
  });
}

exports.handler = async function() {
  try {
    var result = await get('https://www.youtube.com/feeds/videos.xml?channel_id=UC84OTRAO0FMDgMY1u9pbOBg');
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
      body: result.body,
    };
  } catch(err) {
    return { statusCode: 500, body: err.message };
  }
};
