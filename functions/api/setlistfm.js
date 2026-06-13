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

  console.log(`[setlistfm] → GET ${sfmUrl} (key: ${apiKey.slice(0, 8)}…)`);

  let upstream;
  try {
    upstream = await fetch(sfmUrl, {
      headers: {
        'x-api-key': apiKey,
        'Accept': 'application/json',
        'User-Agent': 'WorldInTheirEyes/1.0',
      },
    });
  } catch (err) {
    console.error(`[setlistfm] fetch threw: ${err}`);
    return json({ error: `Network error reaching Setlist.fm: ${err.message}`, debug: { err: String(err) } }, 502);
  }

  const body = await upstream.text();
  const isOk = upstream.status >= 200 && upstream.status < 300;
  const retryAfter = upstream.headers.get('Retry-After');

  console.log(`[setlistfm] ← ${upstream.status} retry-after=${retryAfter} body=${body.slice(0, 200)}`);

  // Pass useful debug info back to the browser on non-2xx
  if (!isOk) {
    let parsed;
    try { parsed = JSON.parse(body); } catch { parsed = { raw: body.slice(0, 300) }; }
    const debugPayload = {
      error: parsed?.message || parsed?.error || body.slice(0, 300),
      status: upstream.status,
      retryAfter,
      debug: { sfmUrl, keyPrefix: apiKey.slice(0, 8), upstreamHeaders: Object.fromEntries(upstream.headers) },
    };
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    };
    if (retryAfter) headers['Retry-After'] = retryAfter;
    return new Response(JSON.stringify(debugPayload), { status: upstream.status, headers });
  }

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
