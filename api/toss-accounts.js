const { tossGet } = require('../lib/toss');

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    var r = await tossGet('/api/v1/accounts');
    if (r.status !== 200) return res.status(r.status).json(r.json || { error: r.text });
    res.json(r.json);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};
