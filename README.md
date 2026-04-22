# Bingo Generator

A static-site bingo card generator hosted on Neocities. Respondents fill out a survey form; the admin generates a card PNG server-side and delivers it via a Tumblr @mention post or Resend email.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Static HTML/CSS/JS on Neocities |
| Backend | Supabase (PostgreSQL, Storage, Edge Functions, Auth) |
| Card rendering | `@resvg/resvg-wasm` in a Deno Edge Function |
| Tumblr delivery | Tumblr NPF API (photo post) |
| Email delivery | Resend API |

---

## Setup

### 1. Supabase project

1. Create a new project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run the following to create the schema:

```sql
-- One row per form submission
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  respondent_name text not null check (char_length(respondent_name) between 1 and 80),
  contact_type text not null check (contact_type in ('tumblr','email')),
  contact_value text not null check (char_length(contact_value) between 1 and 120),
  card_size text not null check (card_size in ('nano','mini','standard')),
  card_status text not null default 'pending'
    check (card_status in ('pending','generating','ready','sent','error')),
  card_storage_path text,
  gen_attempts int not null default 0,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.submissions (card_status);
create index on public.submissions (created_at desc);

-- One row per checked option per submission
create table public.submission_picks (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  question_id text not null,
  option_id text not null,
  option_text text not null check (char_length(option_text) between 1 and 200)
);
create index on public.submission_picks (submission_id);

-- RLS
alter table public.submissions enable row level security;
alter table public.submission_picks enable row level security;

create policy "anon insert submissions" on public.submissions
  for insert to anon with check (true);
create policy "anon insert picks" on public.submission_picks
  for insert to anon with check (true);

create policy "admin read submissions" on public.submissions
  for select to authenticated using (true);
create policy "admin read picks" on public.submission_picks
  for select to authenticated using (true);

-- Settings (stores Tumblr token for auto-send)
create table public.settings (
  key   text primary key,
  value text not null
);
alter table public.settings enable row level security;
create policy "admin manage settings" on public.settings
  for all to authenticated using (true) with check (true);
```

3. Go to **Storage → New bucket**. Name it `cards`, leave it **private**.
4. In **SQL Editor**, run the following to allow the admin to read cards:

```sql
CREATE POLICY "admin read cards"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'cards');
```

### 2. Admin user

In Supabase dashboard: **Authentication → Users → Add user**. Enter your email and a strong password. There is no signup UI on the admin page — this is intentional.

### 3. Fonts

1. Download these fonts:
   - **Inter-Regular.ttf** and **Inter-Bold.ttf** — from [Google Fonts](https://fonts.google.com/specimen/Inter) (click "Download family", unzip, find the TTF files in the `static/` folder).
   - **NotoSans-Regular.ttf** — from [Google Fonts](https://fonts.google.com/noto/specimen/Noto+Sans) (download family, find the Regular weight TTF).
2. In Supabase dashboard → **Storage → New bucket**. Name it `fonts`, set it to **public**.
3. Upload all three TTF files into the `fonts` bucket.

### 4. Tumblr app

1. Go to [tumblr.com/oauth/apps](https://www.tumblr.com/oauth/apps) → **Register application**.
2. Fill in the details. Set **Default callback URL** and **OAuth2 redirect URLs** to the full URL of your admin page (including any subpath), e.g.:
   ```
   https://yourblog.neocities.org/bingo/admin.html
   ```
   Use your actual deployed path — the URL must match exactly where `admin.html` is served.
3. Note your **OAuth2 Client ID** and **Client Secret**.

### 5. Resend

1. Sign up at [resend.com](https://resend.com).
2. Add and verify your sending domain.
3. Create an API key with **Sending access**.

### 6. Supabase secrets

In Supabase dashboard → **Settings → Edge Functions → Secrets**, add:

| Secret | Value |
|---|---|
| `TUMBLR_CLIENT_ID` | From your Tumblr app |
| `TUMBLR_CLIENT_SECRET` | From your Tumblr app |
| `TUMBLR_BLOG_IDENTIFIER` | Your blog, e.g. `yourblog.tumblr.com` |
| `RESEND_API_KEY` | From Resend |
| `FREE_CELL_TEXT` | Must match `window.FREE_CELL_TEXT` in `survey-data.js` (default: `FREE`) |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by the Supabase runtime.

### 7. Deploy Edge Functions

Install the [Supabase CLI](https://supabase.com/docs/guides/cli), then:

```bash
supabase login
supabase link --project-ref your-project-ref
supabase functions deploy generate-card --no-verify-jwt
supabase functions deploy send-card --no-verify-jwt
supabase functions deploy tumblr-token-exchange --no-verify-jwt
```

> The `--no-verify-jwt` flag is required for projects using ES256 JWT signing (all projects created after mid-2024). Without it the functions return an `UNAUTHORIZED_UNSUPPORTED_TOKEN_ALGORITHM` error.

### 8. DB Webhook

In Supabase dashboard → **Database → Webhooks → Create webhook**:

| Field | Value |
|---|---|
| Name | `on-submission-insert` |
| Table | `submissions` |
| Events | `INSERT` |
| Webhook URL | `https://your-project-ref.supabase.co/functions/v1/generate-card` |
| HTTP method | `POST` |
| HTTP headers | `Authorization: Bearer <your-service-role-key>` |

### 9. Configure `config.js`

Copy `src/config.example.js` to `src/config.js` and fill in:

```js
const SUPABASE_URL    = 'https://your-project-ref.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key';
const TUMBLR_CLIENT_ID  = 'your-tumblr-client-id';
```

Find `SUPABASE_URL` and `SUPABASE_ANON_KEY` in Supabase dashboard → **Settings → API**.

**Do not commit `src/config.js`** — it contains your anon key. It is already listed in `.gitignore`.

### 10. Customize `survey-data.js`

Replace the placeholder questions and options in `src/survey-data.js` with your own. Keep `id` values stable — changing them after submissions exist will orphan those picks in the admin view.

Update the `CARD_*` constants (Tumblr caption template, email subject/body, etc.) as needed.

### 11. Deploy to Neocities

Upload all files from the `src/` folder to your Neocities site:

```
src/index.html
src/admin.html
src/styles.css
src/config.js
src/survey-data.js
src/survey.js
src/admin.js
```

Do **not** upload `src/config.example.js`, `supabase/`, or `README.md` unless you want them public.

---

## Usage

### Survey form (`index.html`)

Share the URL with your audience. They fill in their name, contact method (Tumblr handle or email), card size, and their option picks, then submit.

### Admin dashboard (`admin.html`)

1. Log in with the email/password you created in step 2.
2. Click **Connect Tumblr** and complete the OAuth flow. This saves the token server-side so cards are delivered automatically — you only need to do this once (or again if the token expires).
3. The submissions table shows all submissions. Cards are generated and sent automatically after submission — you should see them arrive at `sent` status without any manual action.
4. If a card is stuck in `generating` for more than 2 minutes, click **Regenerate**.
5. If auto-send fails, the card stays at `ready` — click **Send** to deliver it manually.
6. Click **Preview** to view a card PNG before or after sending.
7. Use **Delete PNG** to remove a card from storage and reset the row to `pending` so it can be regenerated.

---

## Card sizes

| Size | Grid | Min picks | Canvas |
|---|---|---|---|
| Nano | 1×3 | 3 | 1200×400 px |
| Mini | 3×3 + FREE | 8 | 1275×1650 px |
| Standard | 5×5 + FREE | 24 | 1275×1650 px |

---

## Troubleshooting

**Card stuck in `pending` or `generating`**
Check **Supabase dashboard → Edge Functions → Logs → generate-card** for errors.
Common causes: font files missing, WASM fetch failed, Storage bucket not created, webhook misconfigured.

**Tumblr send returns 401**
Your Tumblr OAuth token expired. Click **Connect Tumblr** again to re-authorize.

**Email not delivered**
Check Resend logs. Verify the `from_email` domain is verified in your Resend account. Check that `RESEND_API_KEY` is set correctly.

**"Not enough picks" error**
The DB Webhook fired before the client finished inserting picks. The Edge Function polls up to 5 × 1 s. If picks still didn't arrive, click **Regenerate** to retry.
