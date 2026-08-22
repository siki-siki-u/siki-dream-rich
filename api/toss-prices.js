const { tossGet } = require('../lib/toss');

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var symbols = ((req.query && req.query.symbols) || '').trim();
  if (!symbols) return res.status(400).json({ error: 'symbols 파라미터 필요 (콤마로 구분)' });

  try {
    var r = await tossGet('/api/v1/prices?symbols=' + encodeURIComponent(symbols));
    if (r.status !== 200) return res.status(r.status).json(r.json || { error: r.text });
    res.json(r.json);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};
