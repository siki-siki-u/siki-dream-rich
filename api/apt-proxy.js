export const config = { runtime: 'edge' };

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const lawdCd = url.searchParams.get('lawdCd');
  const ym     = url.searchParams.get('ym');
  const key    = process.env.MOLIT_API_KEY || process.env.seoul_apt || '';

  if (!lawdCd || !ym) {
    return new Response(JSON.stringify({ error: 'lawdCd, ym 파라미터 필요' }), { status: 400, headers: corsHeaders });
  }
  if (!key) {
    return new Response(JSON.stringify({ error: 'MOLIT_API_KEY 환경변수 없음' }), { status: 500, headers: corsHeaders });
  }

  const apiUrl =
    'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev' +
    '?serviceKey=' + encodeURIComponent(key) +
    '&LAWD_CD=' + lawdCd +
    '&DEAL_YMD=' + ym +
    '&numOfRows=100&pageNo=1';

  try {
    const res  = await fetch(apiUrl);
    const text = await res.text();

    if (res.status !== 200) {
      return new Response(JSON.stringify({ error: 'upstream ' + res.status, raw: text.slice(0, 300) }), { status: 502, headers: corsHeaders });
    }

    const items = [];
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const e  = m[1];
      const gv = (tag) => {
        const match = e.match(new RegExp('<' + tag + '>[\\s\\S]*?<\\/' + tag + '>'));
        return match ? match[0].replace(/<[^>]*>/g, '').trim() : '';
      };
      const price = gv('dealAmount').replace(/,/g, '');
      if (!price || isNaN(Number(price))) continue;
      const yr = gv('dealYear');
      const mo = gv('dealMonth').padStart(2, '0');
      const dy = gv('dealDay').padStart(2, '0');
      items.push({
        aptNm: gv('aptNm'),
        price: Number(price),
        year:  yr,
        month: gv('dealMonth'),
        day:   gv('dealDay'),
        date:  yr + '-' + mo + '-' + dy,
        floor: gv('floor'),
        area:  gv('excluUseAr'),
        umdNm: gv('umdNm'),
      });
    }

    return new Response(JSON.stringify({ items, count: items.length }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
}
