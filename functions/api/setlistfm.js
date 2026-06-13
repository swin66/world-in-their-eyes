// Cloudflare Pages Function — proxies Setlist.fm API to avoid browser CORS blocks.
// Deployed automatically alongside the Pages site, runs on Cloudflare's edge.
// Free tier: 100,000 requests/day.

export async function onRequest(context) {
  const { request } = context;

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'x-sfm-key',
        'Access-Control-Allow-Methods': 'GET',
      },
    });
  }

  const url = new URL(request.url);
  const artist = url.searchParams.get('artist') || '';
  const page = url.searchParams.get('p') || '1';
  const apiKey = request.headers.get('x-sfm-key') || '';

  if (!apiKey) {
    return json({ error: 'Missing x-sfm-key header' }, 401);
  }
  if (!artist) {
    return json({ error: 'Missing artist param' }, 400);
  }

  const sfmUrl =
    `https://api.setlist.fm/rest/1.0/search/setlists` +
    `?artistName=${encodeURIComponent(artist)}&p=${encodeURIComponent(page)}`;

  const upstream = await fetch(sfmUrl, {
    headers: {
      'x-api-key': apiKey,
      'Accept': 'application/json',
    },
  });

  const body = await upstream.text();
  const isOk = upstream.status >= 200 && upstream.status < 300;
  const retryAfter = upstream.headers.get('Retry-After');
  const responseHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': isOk ? 'public, max-age=3600' : 'no-store',
  };
  if (retryAfter) responseHeaders['Retry-After'] = retryAfter;
  return new Response(body, { status: upstream.status, headers: responseHeaders });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
