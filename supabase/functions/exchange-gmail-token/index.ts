import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('authorization');
  if (!authHeader) return json({ ok: false, error: 'Unauthorized' }, 401);

  const jwtToken = authHeader.replace(/^Bearer\s+/i, '');
  const isAuthorized = (() => {
    try {
      const payload = JSON.parse(atob(jwtToken.split('.')[1]));
      return payload.role === 'service_role' || payload.role === 'authenticated';
    } catch { return false; }
  })();

  if (!isAuthorized) return json({ ok: false, error: 'Unauthorized' }, 401);

  const svc = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: { code: string; redirect_uri: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const { code, redirect_uri } = body;
  if (!code || !redirect_uri) return json({ ok: false, error: 'Missing code or redirect_uri' }, 400);

  const clientId     = Deno.env.get('GMAIL_CLIENT_ID')!;
  const clientSecret = Deno.env.get('GMAIL_CLIENT_SECRET')!;

  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     clientId,
      client_secret: clientSecret,
      redirect_uri,
      grant_type:    'authorization_code',
    }),
  });

  if (!tokenResp.ok) {
    const errText = await tokenResp.text();
    console.error('Gmail token exchange failed:', tokenResp.status, errText);
    return json({ ok: false, error: 'Token exchange failed' }, 502);
  }

  const tokens = await tokenResp.json();
  const { access_token, refresh_token } = tokens;

  if (!refresh_token) {
    return json({
      ok: false,
      error: 'No refresh token returned — revoke app access at myaccount.google.com/permissions and try again',
    }, 400);
  }

  // Fetch Gmail address to display in the admin UI
  const userResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const userInfo = userResp.ok ? await userResp.json() : {};
  const gmailEmail = userInfo.email ?? '';

  const upserts = [
    { key: 'gmail_refresh_token', value: refresh_token },
    { key: 'gmail_auth_status',   value: 'ok' },
    { key: 'gmail_email',         value: gmailEmail },
  ];

  for (const row of upserts) {
    const { error } = await svc.from('settings').upsert(row, { onConflict: 'key' });
    if (error) console.error('Failed to upsert setting:', row.key, error.message);
  }

  return json({ ok: true, email: gmailEmail });
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
