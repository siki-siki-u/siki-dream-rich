const { tossGet } = require('../lib/toss');

var _cache = { list: null, at: 0 };
var TTL_MS = 12 * 60 * 60 * 1000;

async function loadUniverse() {
  if (_cache.list && Date.now() - _cache.at < TTL_MS) return _cache.list;
  var markets = ['KOSPI', 'KOSDAQ'];
  var all = [];
  for (var i = 0; i < markets.length; i++) {
    var r = await tossGet('/api/v1/stocks/all?market=' + markets[i] + '&securityType=STOCK');
    if (r.status === 200 && r.json && r.json.result) {
      all = all.concat(r.json.result.map(function(s) { return Object.assign({ market: markets[i] }, s); }));
    }
  }
  _cache = { list: all, at: Date.now() };
  return all;
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var q = ((req.query && req.query.q) || '').trim();
  if (!q) return res.json({ result: [] });

  try {
    var universe = await loadUniverse();
    var matched = universe.filter(function(s) {
      return (s.name && s.name.indexOf(q) !== -1) || (s.symbol && s.symbol.indexOf(q) !== -1);
    }).slice(0, 30);
    res.json({ result: matched });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};
