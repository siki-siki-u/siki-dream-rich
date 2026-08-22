const { tossGet } = require('../lib/toss');

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    var accountSeq = (req.query && req.query.accountSeq) || '';

    if (!accountSeq) {
      var accR = await tossGet('/api/v1/accounts');
      if (accR.status !== 200) return res.status(accR.status).json(accR.json || { error: accR.text });
      var accounts = (accR.json && accR.json.result) || [];
      if (!accounts.length) return res.json({ result: null, message: '연결된 계좌가 없어요' });
      accountSeq = accounts[0].accountSeq;
    }

    var r = await tossGet('/api/v1/holdings', {
      headers: { 'X-Tossinvest-Account': String(accountSeq) },
    });
    if (r.status !== 200) return res.status(r.status).json(r.json || { error: r.text });
    res.json(r.json);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};
