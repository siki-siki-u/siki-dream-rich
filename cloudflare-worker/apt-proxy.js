// Cloudflare Worker — MOLIT 실거래가 API 한국 엣지 프록시
// 배포: workers.cloudflare.com → 새 Worker → 아래 코드 붙여넣기 → 배포
// 환경변수: MOLIT_KEY = data.go.kr 서비스키 (Settings > Variables > Add variable)

export default {
  async fetch(req, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(req.url);
    const lawdCd = url.searchParams.get('lawdCd');
    const ym     = url.searchParams.get('ym');

    if (!lawdCd || !ym) {
      return new Response(JSON.stringify({ error: 'lawdCd, ym 파라미터 필요' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const KEY = env.MOLIT_KEY;
    if (!KEY) {
      return new Response(JSON.stringify({ error: 'MOLIT_KEY 환경변수 미설정' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const apiUrl =
      'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev' +
      '?serviceKey=' + encodeURIComponent(KEY) +
      '&LAWD_CD=' + lawdCd +
      '&DEAL_YMD=' + ym +
      '&numOfRows=100&pageNo=1';

    try {
      const res  = await fetch(apiUrl);
      const text = await res.text();

      if (res.status !== 200) {
        return new Response(JSON.stringify({ error: 'upstream ' + res.status, body: text.slice(0, 300) }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
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
          date:  yr + '-' + mo + '-' + dy,
          floor: gv('floor'),
          area:  gv('excluUseAr'),
        });
      }

      return new Response(JSON.stringify({ items, count: items.length }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },
};
