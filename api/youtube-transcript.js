const https = require('https');

function get(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      }
    }, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); });
    }).on('error', reject);
  });
}

function parseXmlTranscript(xml) {
  var texts = [];
  var re = /<text[^>]*>([\s\S]*?)<\/text>/g;
  var m;
  while ((m = re.exec(xml)) !== null) {
    var t = m[1]
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/<[^>]+>/g, '').trim();
    if (t) texts.push(t);
  }
  return texts.join(' ');
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var videoId = (req.query && req.query.videoId) || (req.body && req.body.videoId);
  if (!videoId) return res.status(400).json({ error: 'videoId 필요' });

  try {
    // 1. YouTube 페이지 가져오기
    var page = await get('https://www.youtube.com/watch?v=' + videoId + '&hl=ko');
    if (page.status !== 200) throw new Error('YouTube 페이지 로드 실패: ' + page.status);

    // 2. ytInitialPlayerResponse 추출
    var match = page.body.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var |const |let |\w)/s);
    if (!match) throw new Error('플레이어 데이터 없음');

    var player;
    try { player = JSON.parse(match[1]); } catch(e) { throw new Error('플레이어 JSON 파싱 실패'); }

    // 3. 자막 트랙 목록
    var captions = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!captions || !captions.length) {
      return res.json({ transcript: null, lang: null, message: '자막 없음' });
    }

    // 한국어 우선, 없으면 영어, 없으면 첫 번째
    var track = captions.find(function(c) { return c.languageCode === 'ko'; })
      || captions.find(function(c) { return c.languageCode === 'en'; })
      || captions[0];

    var captionUrl = track.baseUrl;
    if (!captionUrl.startsWith('http')) captionUrl = 'https://www.youtube.com' + captionUrl;

    // 4. 자막 XML 가져오기
    var xml = await get(captionUrl);
    if (xml.status !== 200) throw new Error('자막 다운로드 실패');

    // 5. 텍스트 추출
    var transcript = parseXmlTranscript(xml.body);
    if (!transcript) throw new Error('자막 텍스트 추출 실패');

    // 너무 길면 앞 8000자만 (Claude 토큰 절약)
    if (transcript.length > 8000) transcript = transcript.slice(0, 8000) + '...(이하 생략)';

    res.json({ transcript: transcript, lang: track.languageCode, name: track.name?.simpleText || '' });

  } catch(e) {
    res.json({ transcript: null, lang: null, message: e.message });
  }
};
