module.exports = function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.json({ molitKey: process.env.MOLIT_API_KEY || process.env.seoul_apt || '' });
};
