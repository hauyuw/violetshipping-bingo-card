import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const svc = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const selfUri  = `${Deno.env.get('SUPABASE_URL')}/functions/v1/exchange-gmail-token`;
  const adminUrl = Deno.env.get('ADMIN_URL')!;

  // ── GET: Google redirects here after the user grants permission ───────────
  if (req.method === 'GET') {
    const url   = new URL(req.url);
    const code  = url.searchParams.get('code');
    const state = url.searchParams.get('state') ?? '';
    const error = url.searchParams.get('error');

    if (error || !code) {
      return Response.redirect(
        `${adminUrl}?gmail_error=${encodeURIComponent(error || 'cancelled')}`,
        302,
      );
    }

    const result = await exchangeAndStore(svc, code, selfUri);

    if (!result.ok) {
      return Response.redirect(
        `${adminUrl}?gmail_error=${encodeURIComponent(result.error)}`,
        302,
      );
    }

    return Response.redirect(
      `${adminUrl}?gmail_connected=1&gmail_email=${encodeURIComponent(result.email)}&state=${encodeURIComponent(state)}`,
      302,
    );
  }

  return json({ ok: false, error: 'Method not allowed' }, 405);
});

async function exchangeAndStore(
  svc: ReturnType<typeof createClient>,
  code: string,
  redirectUri: string,
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     Deno.env.get('GMAIL_CLIENT_ID')!,
      client_secret: Deno.env.get('GMAIL_CLIENT_SECRET')!,
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
    }),
  });

  if (!tokenResp.ok) {
    console.error('Gmail token exchange failed:', tokenResp.status, await tokenResp.text());
    return { ok: false, error: 'token_exchange_failed' };
  }

  const tokens = await tokenResp.json();
  if (!tokens.refresh_token) return { ok: false, error: 'no_refresh_token' };

  const userResp   = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const gmailEmail = userResp.ok ? ((await userResp.json()).email ?? '') : '';

  for (const row of [
    { key: 'gmail_refresh_token', value: tokens.refresh_token },
    { key: 'gmail_auth_status',   value: 'ok' },
    { key: 'gmail_email',         value: gmailEmail },
  ]) {
    const { error } = await svc.from('settings').upsert(row, { onConflict: 'key' });
    if (error) console.error('Failed to upsert setting:', row.key, error.message);
  }

  return { ok: true, email: gmailEmail };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
