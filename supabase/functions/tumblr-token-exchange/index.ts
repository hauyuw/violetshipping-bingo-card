import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // Require authenticated admin session or service role
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const jwtToken = authHeader.replace(/^Bearer\s+/i, '');
  const isAuthorized = (() => {
    try {
      const payload = JSON.parse(atob(jwtToken.split('.')[1]));
      return payload.role === 'service_role' || payload.role === 'authenticated';
    } catch { return false; }
  })();

  if (!isAuthorized) return json({ error: 'Unauthorized' }, 401);

  let body: { code?: string; code_verifier?: string; redirect_uri?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { code, code_verifier, redirect_uri } = body;
  if (!code || !code_verifier || !redirect_uri) {
    return json({ error: 'Missing required fields: code, code_verifier, redirect_uri' }, 400);
  }

  const clientId     = Deno.env.get('TUMBLR_CLIENT_ID')!;
  const clientSecret = Deno.env.get('TUMBLR_CLIENT_SECRET')!;

  // Exchange code for access token
  const tokenResp = await fetch('https://api.tumblr.com/v2/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      code_verifier,
      redirect_uri,
      client_id:     clientId,
      client_secret: clientSecret,
    }),
  });

  if (!tokenResp.ok) {
    const errText = await tokenResp.text();
    console.error('Tumblr token exchange failed:', tokenResp.status, errText);
    return json({ error: `Tumblr token exchange failed: ${tokenResp.status}` }, 502);
  }

  const tokenData = await tokenResp.json();
  const accessToken: string = tokenData.access_token;

  if (!accessToken) {
    return json({ error: 'No access_token in Tumblr response' }, 502);
  }

  // Fetch primary blog name to surface in the UI
  const userInfoResp = await fetch('https://api.tumblr.com/v2/user/info', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  let primaryBlogName = '';
  if (userInfoResp.ok) {
    const userInfo = await userInfoResp.json();
    primaryBlogName = userInfo?.response?.user?.blogs?.find(
      (b: { primary: boolean; name: string }) => b.primary
    )?.name ?? '';
  }

  return json({ access_token: accessToken, primary_blog_name: primaryBlogName }, 200);
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
