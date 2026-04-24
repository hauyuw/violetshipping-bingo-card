import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

async function getGmailAccessToken(
  svc: ReturnType<typeof createClient>,
  refreshToken: string,
): Promise<string | null> {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id:     Deno.env.get('GMAIL_CLIENT_ID')!,
      client_secret: Deno.env.get('GMAIL_CLIENT_SECRET')!,
      grant_type:    'refresh_token',
    }),
  });

  if (!resp.ok) {
    console.error('Gmail access token refresh failed:', resp.status, await resp.text());
    await svc.from('settings').upsert({ key: 'gmail_auth_status', value: 'needs_reauth' }, { onConflict: 'key' });
    return null;
  }

  const data = await resp.json();
  return data.access_token ?? null;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

interface SendCardBody {
  submission_id:            string;
  tumblr_token?:            string;
  card_tags?:               string[];
  tumblr_caption_template?: string;
  tumblr_post_state?:       'published' | 'queue' | 'draft';
  email_subject_template?:  string;
  email_body_template?:     string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // Require authenticated admin session or internal service role call
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

  // Use service role for storage + DB writes
  const svc = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: SendCardBody;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const { submission_id } = body;
  if (!submission_id) return json({ ok: false, error: 'Missing submission_id' }, 400);

  // Fetch submission
  const { data: sub, error: subErr } = await svc
    .from('submissions')
    .select('*')
    .eq('id', submission_id)
    .single();

  if (subErr || !sub) return json({ ok: false, error: 'Submission not found' }, 404);

  if (sub.card_status !== 'ready' && sub.card_status !== 'sent') {
    return json({ ok: false, error: `Card is not ready (status: ${sub.card_status})` }, 400);
  }

  const storagePath = sub.card_storage_path as string;
  if (!storagePath) return json({ ok: false, error: 'No card_storage_path on submission' }, 400);

  const name   = sub.respondent_name as string;
  const handle = sub.contact_value  as string;

  function fillTemplate(tpl: string): string {
    return tpl.replace(/\{handle\}/g, handle).replace(/\{name\}/g, name);
  }

  // ── Send ──────────────────────────────────────────────────────────────────

  if (sub.contact_type === 'tumblr') {
    const token = body.tumblr_token;
    if (!token) return json({ ok: false, error: 'Missing tumblr_token' }, 400);

    const blogId = Deno.env.get('TUMBLR_BLOG_IDENTIFIER')!;
    const tags   = body.card_tags ?? ['bingo'];
    const state  = body.tumblr_post_state ?? 'published';

    // Create a short-lived signed URL so Tumblr can fetch the image directly
    const { data: signedData, error: signedErr } = await svc.storage
      .from('cards')
      .createSignedUrl(storagePath, 3600);

    if (signedErr || !signedData?.signedUrl) {
      return json({ ok: false, error: `Failed to create signed URL: ${signedErr?.message}` }, 500);
    }

    const imageUrl = signedData.signedUrl;

    const rawTpl      = body.tumblr_caption_template ?? "@{handle} here's your bingo card!";
    const captionText = rawTpl.replace(/\{handle\}/g, handle).replace(/\{name\}/g, name);

    // Fetch blog UUID for NPF @mention
    let blogUuid: string | null = null;
    try {
      const infoResp = await fetch(`https://api.tumblr.com/v2/blog/${handle}/info`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (infoResp.ok) {
        const infoData = await infoResp.json();
        blogUuid = infoData?.response?.blog?.uuid ?? null;
      }
    } catch { /* fall back to plain text */ }

    const textBlock: Record<string, unknown> = { type: 'text', text: captionText };
    if (blogUuid) {
      const mentionStart = captionText.indexOf(`@${handle}`);
      if (mentionStart !== -1) {
        textBlock.formatting = [{
          start: mentionStart,
          end:   mentionStart + handle.length + 1,
          type:  'mention',
          blog:  { uuid: blogUuid },
        }];
      }
    }

    const npfBody = {
      content: [
        { type: 'image', media: [{ type: 'image/png', url: imageUrl }] },
        textBlock,
      ],
      tags: tags.join(','),
      state,
    };

    const tumblrResp = await fetch(
      `https://api.tumblr.com/v2/blog/${blogId}/posts`,
      {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(npfBody),
      },
    );

    if (tumblrResp.status === 401) {
      return json({ ok: false, error: 'TUMBLR_TOKEN_EXPIRED' }, 401);
    }

    if (!tumblrResp.ok) {
      const errBody = await tumblrResp.text();
      console.error('Tumblr post failed:', tumblrResp.status, errBody);
      return json({ ok: false, error: `Tumblr API error ${tumblrResp.status}` }, 502);
    }
  } else if (sub.contact_type === 'email') {
    // Download PNG binary for email attachment
    const { data: fileData, error: dlErr } = await svc.storage
      .from('cards')
      .download(storagePath);

    if (dlErr || !fileData) {
      return json({ ok: false, error: `Failed to download card PNG: ${dlErr?.message}` }, 500);
    }

    const pngBuf = new Uint8Array(await fileData.arrayBuffer());
    let binary = '';
    for (let i = 0; i < pngBuf.length; i += 8192) {
      binary += String.fromCharCode(...pngBuf.subarray(i, i + 8192));
    }
    const pngBase64 = btoa(binary);

    // Fetch Gmail credentials from settings
    const { data: settingsRows } = await svc
      .from('settings')
      .select('key, value')
      .in('key', ['gmail_refresh_token', 'gmail_email']);

    const settingsMap: Record<string, string> = {};
    for (const row of (settingsRows ?? [])) settingsMap[row.key] = row.value;

    const refreshToken = settingsMap['gmail_refresh_token'];
    if (!refreshToken) return json({ ok: false, error: 'GMAIL_NEEDS_REAUTH' }, 400);

    const accessToken = await getGmailAccessToken(svc, refreshToken);
    if (!accessToken) return json({ ok: false, error: 'GMAIL_NEEDS_REAUTH' }, 401);

    const fromEmail = settingsMap['gmail_email'] || Deno.env.get('FROM_EMAIL') || '';
    const fromName  = Deno.env.get('FROM_NAME') ?? 'Bingo Generator';
    const replyTo   = Deno.env.get('REPLY_TO') ?? '';
    const subject   = fillTemplate(body.email_subject_template ?? "{name}, here's your bingo card!");
    const textBody  = fillTemplate(body.email_body_template    ?? "Hey {name}, here's your bingo card! It's attached.");

    const boundary = '----=_BingoBoundary';
    let mime = `MIME-Version: 1.0\r\n`;
    mime += `From: ${fromName} <${fromEmail}>\r\n`;
    mime += `To: ${sub.contact_value as string}\r\n`;
    if (replyTo) mime += `Reply-To: ${replyTo}\r\n`;
    mime += `Subject: ${subject}\r\n`;
    mime += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;
    mime += `--${boundary}\r\n`;
    mime += `Content-Type: text/plain; charset=UTF-8\r\n\r\n`;
    mime += `${textBody}\r\n\r\n`;
    mime += `--${boundary}\r\n`;
    mime += `Content-Type: image/png\r\n`;
    mime += `Content-Transfer-Encoding: base64\r\n`;
    mime += `Content-Disposition: attachment; filename="bingo-card.png"\r\n\r\n`;
    mime += pngBase64.match(/.{1,76}/g)!.join('\r\n');
    mime += `\r\n--${boundary}--`;

    const mimeBytes = new TextEncoder().encode(mime);
    let mimeBin = '';
    for (let i = 0; i < mimeBytes.length; i += 8192) {
      mimeBin += String.fromCharCode(...mimeBytes.subarray(i, i + 8192));
    }
    const rawMessage = btoa(mimeBin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const gmailResp = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw: rawMessage }),
      },
    );

    if (gmailResp.status === 401) {
      await svc.from('settings').upsert({ key: 'gmail_auth_status', value: 'needs_reauth' }, { onConflict: 'key' });
      return json({ ok: false, error: 'GMAIL_NEEDS_REAUTH' }, 401);
    }

    if (!gmailResp.ok) {
      const errBody = await gmailResp.text();
      console.error('Gmail send failed:', gmailResp.status, errBody);
      return json({ ok: false, error: `Gmail API error ${gmailResp.status}` }, 502);
    }
  } else {
    return json({ ok: false, error: `Unknown contact_type: ${sub.contact_type}` }, 400);
  }

  // Update status → sent
  const { error: updateErr } = await svc
    .from('submissions')
    .update({ card_status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', submission_id);

  if (updateErr) {
    console.error('Failed to update card_status to sent:', updateErr.message);
    // Delivery succeeded; don't fail the response over a status update blip
  }

  return json({ ok: true });
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
