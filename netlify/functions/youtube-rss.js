exports.handler = async function() {
  const url = 'https://www.youtube.com/feeds/videos.xml?channel_id=UC84OTRAO0FMDgMY1u9pbOBg';
  try {
    const res = await fetch(url);
    const text = await res.text();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
      body: text,
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
