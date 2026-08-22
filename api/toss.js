const { tossGet } = require('../lib/toss');

var _universeCache = { list: null, at: 0 };
var UNIVERSE_TTL_MS = 12 * 60 * 60 * 1000;

async function loadUniverse() {
  if (_universeCache.list && Date.now() - _universeCache.at < UNIVERSE_TTL_MS) return _universeCache.list;
  var markets = ['KOSPI', 'KOSDAQ'];
  var all = [];
  for (var i = 0; i < markets.length; i++) {
    var r = await tossGet('/api/v1/stocks/all?market=' + markets[i] + '&securityType=STOCK');
    if (r.status === 200 && r.json && r.json.result) {
      all = all.concat(r.json.result.map(function(s) { return Object.assign({ market: markets[i] }, s); }));
    }
  }
  _universeCache = { list: all, at: Date.now() };
  return all;
}

async function handleAccounts(req, res) {
  var r = await tossGet('/api/v1/accounts');
  if (r.status !== 200) return res.status(r.status).json(r.json || { error: r.text });
  res.json(r.json);
}

async function handleHoldings(req, res) {
  var accountSeq = (req.query && req.query.accountSeq) || '';
  if (!accountSeq) {
    var accR = await tossGet('/api/v1/accounts');
    if (accR.status !== 200) return res.status(accR.status).json(accR.json || { error: accR.text });
    var accounts = (accR.json && accR.json.result) || [];
    if (!accounts.length) return res.json({ result: null, message: '연결된 계좌가 없어요' });
    accountSeq = accounts[0].accountSeq;
  }
  var r = await tossGet('/api/v1/holdings', { headers: { 'X-Tossinvest-Account': String(accountSeq) } });
  if (r.status !== 200) return res.status(r.status).json(r.json || { error: r.text });
  res.json(r.json);
}

async function handleSearch(req, res) {
  var q = ((req.query && req.query.q) || '').trim();
  if (!q) return res.json({ result: [] });
  var universe = await loadUniverse();
  var matched = universe.filter(function(s) {
    return (s.name && s.name.indexOf(q) !== -1) || (s.symbol && s.symbol.indexOf(q) !== -1);
  }).slice(0, 30);
  res.json({ result: matched });
}

async function handlePrices(req, res) {
  var symbols = ((req.query && req.query.symbols) || '').trim();
  if (!symbols) return res.status(400).json({ error: 'symbols 파라미터 필요 (콤마로 구분)' });
  var r = await tossGet('/api/v1/prices?symbols=' + encodeURIComponent(symbols));
  if (r.status !== 200) return res.status(r.status).json(r.json || { error: r.text });
  res.json(r.json);
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var action = (req.query && req.query.action) || '';
  try {
    if (action === 'accounts') return await handleAccounts(req, res);
    if (action === 'holdings') return await handleHoldings(req, res);
    if (action === 'search')   return await handleSearch(req, res);
    if (action === 'prices')   return await handlePrices(req, res);
    res.status(400).json({ error: 'action 파라미터 필요 (accounts | holdings | search | prices)' });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};
