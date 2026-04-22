# Bingo Generator — Specification v4 (Admin-Delivered Cards, Hardened)

## Context

v2 showed the generated card to the respondent directly in the browser. The user pivoted: respondents
submit the form and the **admin generates + delivers each card privately** via a Tumblr @mention post
or a Resend email. Key consequences:

- No client-side card preview or download on the public site.
- Card generation moves server-side (Supabase Edge Function: SVG template → PNG via `resvg-wasm`).
- Admin dashboard (`admin.html`) gated by Supabase Auth (email + password).
- Tumblr delivery = public post @mentioning the recipient on the admin's main blog.
- Email delivery = auto-sent via Resend API.
- URL-shareable card hash (from v2) removed entirely.

---

## Architecture

```
Neocities (static)                Supabase
──────────────────                ──────────────────────────────────────────
index.html + survey.js  ──────►  submissions  (anon INSERT-only)
                                  submission_picks  (anon INSERT-only)
                                         │
                                  DB Webhook on submissions INSERT
                                         ▼
                                  generate-card Edge Function
                                  • fetch picks → build SVG → resvg-wasm PNG
                                  • save to Storage: cards/{id}.png
                                  • update card_status → 'ready'
                                         │
admin.html + admin.js   ◄──────  SELECT (authenticated admin only)
                         calls   send-card Edge Function (per submission)
                                  • Tumblr: POST photo + @mention caption
                                  • Email: Resend API with PNG attachment
                                  • update card_status → 'sent'
```

---

## Survey form changes from v2

### Contact field — split into two paths

The single "Tumblr username or email" input becomes a radio + conditional input:

```html
<fieldset id="contact-type">
  <legend>How should we send your card?</legend>
  <label><input type="radio" name="contact_type" value="tumblr" checked>
    Tumblr — I'll get a post @mentioning me</label>
  <label><input type="radio" name="contact_type" value="email">
    Email — send it to my inbox</label>
</fieldset>
<input id="contact-input" required maxlength="120">
<!-- survey.js swaps type="text"/placeholder="your-tumblr-handle"
     ↔ type="email"/placeholder="you@example.com" on radio change -->
```

- **Tumblr:** `type="text"`. On submit, `survey.js` normalizes the handle: strip leading `@`, strip `https://` / `http://`, strip `.tumblr.com` suffix, lowercase. Accepts input formats like `name`, `@name`, `name.tumblr.com`, `https://name.tumblr.com` → all save as `name`.
- **Email:** `type="email"`, HTML5 validation.

### Post-submit state (hardcoded copy)

Hide the form, show:

> **Thanks for submitting! Your bingo card will be sent to your Tumblr / email shortly.**

Below that: the list of options they checked, grouped by question label (so they can verify their picks). No card preview, no PNG download, no URL hash.

### Retained from v2

- Name (required, maxlength 80)
- Card size radios: Nano / Mini (+FREE) / Standard (+FREE); default Mini
- Multi-select checkboxes per question, collapsible > 10 options
- Live picks counter `Picks: X / Y needed for <size>` near size radios
- Block submit if picks < min_for_size with inline hint
- Submit button: **Submit & Get My Card**

### Removed from v2

- URL hash / seed encoding
- Client-side card canvas rendering
- Download PNG / Copy Link / Share… / Make Your Own buttons

### Anti-spam honeypot (new)

A hidden text input is added to the form:

```html
<input type="text" name="website" id="hp-website" autocomplete="off"
       tabindex="-1" aria-hidden="true" class="honeypot">
```
```css
.honeypot { position: absolute; left: -9999px; width: 1px; height: 1px;
            opacity: 0; pointer-events: none; }
```

`survey.js` checks `document.getElementById('hp-website').value` before submit.
If non-empty, the submit handler returns silently (no DB insert, no visible error).
Real users never see the field; naive bots fill it and are dropped.

### Page layout & branding

Both `index.html` and `admin.html` include a branding slot at the top of the container:

```html
<header class="page-header">
  <div id="logo" class="logo-slot"><!-- deployer drops <img> or SVG here --></div>
  <h1>…</h1>
</header>
```

The logo slot is empty by default. The deployer fills it in after initial deploy
(per-site branding). `styles.css` sizes it to at most 120 px tall on desktop,
60 px on mobile, and hides the surrounding flex row if the slot is empty.

### Meta / SEO

Both `index.html` and `admin.html` include:

```html
<meta name="robots" content="noindex,nofollow">
```

— keeps the form and admin dashboard out of search indexes regardless of who
links to them. No separate `robots.txt` needed; Neocities would serve one but
the meta tag covers both pages directly.

### No-JavaScript fallback

Both HTML files start the `<body>` with a `<noscript>` banner:

```html
<noscript>
  <div class="noscript-banner">
    This site needs JavaScript. Please enable it to continue.
  </div>
</noscript>
```

Styled prominently (e.g. `--error` background, white text, full-width). Without
JS nothing else on either page works, so failing loudly is the right call.

### Initial loading state

Each dynamic region of both pages ships with a `<p class="loading">Loading…</p>`
placeholder that `survey.js` / `admin.js` replaces once data is ready. On the
admin page this covers the session-check (login vs dashboard) and the
submissions table. On the form page it covers the questions container. No
spinner assets; the inline text is replaced in <500 ms on typical loads.

---

## Database schema

```sql
-- One row per form submission
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  respondent_name text not null
    check (char_length(respondent_name) between 1 and 80),
  contact_type text not null check (contact_type in ('tumblr','email')),
  contact_value text not null
    check (char_length(contact_value) between 1 and 120),
  card_size text not null check (card_size in ('nano','mini','standard')),
  card_status text not null default 'pending'
    check (card_status in ('pending','generating','ready','sent','error')),
  card_storage_path text,          -- set once PNG is saved to Storage
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
  option_text text not null
    check (char_length(option_text) between 1 and 200)
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
```

**Storage:** bucket `cards`, private.
- Path pattern: `cards/{submission_id}.png`
- Admin downloads via a Supabase signed URL from the authenticated client.

---

## On submit (`survey.js`)

1. Validate: name present; contact_value non-empty (+ email regex if contact_type = email); card size chosen; picks ≥ min_for_size(size). Inline errors block submit.
2. **Normalize** contact_value if contact_type = 'tumblr': strip leading `@`, strip `https?://` prefix, strip `.tumblr.com` suffix, lowercase.
3. Insert one row into `submissions`.
4. Insert one row per checked option into `submission_picks` (question_id, option_id, option_text) — all referencing the submissions row id.
5. Hide form; show thank-you message + picks summary.

---

## Edge Function: `generate-card`

**Trigger:** Supabase DB Webhook on `submissions` INSERT.

```
Deno runtime dependencies:
  @resvg/resvg-wasm  — SVG → PNG
  @supabase/supabase-js — DB + Storage (service role)
Bundled assets (in the function directory):
  Inter-Regular.ttf, Inter-Bold.ttf       — primary font (Latin + extended Latin)
  NotoSans-Regular.ttf                     — fallback for non-Latin (CJK, accents,
                                              broad Unicode coverage)
  All three TTFs go into fontBuffers: [...] on the Resvg constructor;
  resvg picks per-glyph fallback automatically. loadSystemFonts stays false.
Env vars read:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FREE_CELL_TEXT
```

**Steps:**
1. Set `card_status = 'generating'`, increment `gen_attempts`.
2. Fetch all rows from `submission_picks` for this submission_id.
3. **Dedupe** picks by `option_id` (keep first occurrence). Defensive guard
   against client tampering or bugs that could produce duplicate `(submission_id, option_id)` rows.
4. Validate deduped picks count ≥ min_for_size(card_size); if not, set error and exit.
5. **Shuffle** picks array using a seeded Fisher–Yates (seed = first 8 chars of submission_id as integer). Deterministic: same submission always produces the same card layout.
6. Take exactly N cells (3 / 8 / 24 for Nano / Mini / Standard). For Mini/Standard, splice `FREE_CELL_TEXT` at the center index (4 / 12).
7. Build SVG string for the appropriate canvas size:
   - **Mini/Standard:** 1275 × 1650 px, ~75 px margin
   - **Nano:** 1200 × 400 px, ~40 px margin
   - Cells are laid out with a **6 px gap** between them (no shared borders) and
     each cell has **`rx="8"` rounded corners**.
   - Each cell: `<rect>` (stroke 3 px, rx 8) + `<text>`/`<tspan>` (word-wrap + auto-shrink)
   - FREE cell: filled `<rect>` with `--accent` + bold white text
   - No outer frame around the grid — margins do the visual separation.
8. Convert SVG → PNG buffer via `resvg-wasm`.
9. Upload buffer to Supabase Storage at `cards/{submission_id}.png`.
10. Update submissions row: `card_status = 'ready'`, `card_storage_path = 'cards/{id}.png'`.

**Error handling:** wrap steps 2–10 in a retry loop (up to 3 attempts, 2 s sleep between).
After 3 failures: `card_status = 'error'`, `error_message = err.message`.

**SVG word-wrap algorithm (pseudo):**
```
fontSize = cellHeight * 0.28   // starting estimate
loop:
  lines = wrapText(text, fontSize, cellWidth - 8px padding)
  if totalLineHeight(lines, fontSize) fits in cell: break
  fontSize -= 2
  if fontSize < 24: truncate last line with '…'; break
emit <tspan> per line, centered vertically in cell
```

**Rationale for 24 px floor:** Tumblr's feed thumbnails render card images
at ~540 px wide, so every px on the card is scaled down ~2.4× in-feed. 24 px
still reads as ~10 px in the feed; 18 px would disappear. Long option text
truncates with `…` sooner, which is the right trade.

---

## Edge Function: `send-card`

**Called by:** admin page (authenticated Supabase client).

**Input:** `{ submission_id, tumblr_token?, card_tags, tumblr_caption_template, tumblr_post_state, from_name, from_email, reply_to, email_subject_template, email_body_template }` in POST body.
(admin.js reads `CARD_TAGS`, `CARD_TUMBLR_CAPTION`, `CARD_TUMBLR_POST_STATE`, `CARD_FROM_NAME`, `CARD_FROM_EMAIL`, `CARD_REPLY_TO`, `CARD_EMAIL_SUBJECT`, `CARD_EMAIL_BODY` from `window` globals set by survey-data.js and passes them here.)

**Steps:**
1. Fetch submission row (verify `card_status = 'ready'` or `'sent'`; abort otherwise).
2. Download card PNG from Supabase Storage as an ArrayBuffer.
3. Fetch submission_picks rows for alt-text construction.
4. **If contact_type = 'tumblr':**
   - POST to `https://api.tumblr.com/v2/blog/{TUMBLR_BLOG_IDENTIFIER}/posts` (NPF multipart, bound media):
     - Single multipart request; `json` part contains NPF content + tags + `state`,
       `card` part contains the PNG binary.
     - **Caption** = `tumblr_caption_template` with `{handle}` replaced by `contact_value`
       and `{name}` replaced by `respondent_name` (default template:
       `"@{handle} here's your bingo card!"`).
     - **alt_text** = all cell contents joined with `" · "` (e.g. `"Option A · Option B · FREE · ..."`).
     - **state** = `tumblr_post_state` (`'published'` | `'queue'` | `'draft'`; default `'published'`).
     - **tags** = `card_tags`.
   - Uses `tumblr_token` from request body (Bearer auth).
   - **If the Tumblr API returns 401:** return `{ ok: false, error: 'TUMBLR_TOKEN_EXPIRED' }` so the admin page can prompt to reconnect.
5. **If contact_type = 'email':**
   - POST to Resend API:
     - `from`: `"{from_name} <{from_email}>"`
     - `to`: `contact_value`
     - `reply_to`: `reply_to` (if non-empty)
     - `subject`: `email_subject_template` with `{name}` replaced by respondent_name
     - Plain-text body: `email_body_template` with `{name}` replaced
     - Attachment: PNG buffer (not inline)
   - Uses `RESEND_API_KEY` secret.
6. Update submissions: `card_status = 'sent'`, `sent_at = now()`.
7. Return `{ ok: true }` or `{ ok: false, error: string }`.

**No idempotency key.** If the Tumblr/email send succeeds but the DB status update in step 6 fails (network blip), a subsequent Resend will post/email again. The admin deletes duplicates manually. Acceptable for v1 given how rare same-region Supabase DB failures are.

---

## Edge Function: `tumblr-token-exchange`

**Purpose:** Exchange a Tumblr OAuth2 authorization code for an access token without exposing `TUMBLR_CLIENT_SECRET` in browser JS.

**Called by:** admin page after Tumblr OAuth2 redirect.

**Input:** `{ code, code_verifier, redirect_uri }`.

**Steps:**
1. POST to `https://api.tumblr.com/v2/oauth2/token` with grant_type=authorization_code,
   code, code_verifier, redirect_uri, client_id (`TUMBLR_CLIENT_ID`), client_secret (`TUMBLR_CLIENT_SECRET`).
2. With the fresh token, GET `https://api.tumblr.com/v2/user/info` to fetch the
   authorized account's primary blog name.
3. Return `{ access_token, primary_blog_name }` to admin page.
4. Admin page stores `tumblr_token` + `tumblr_blog_name` in `localStorage`.
   The Connect button then reads as `Tumblr Connected as @{primary_blog_name}`.

---

## Admin page (`admin.html`)

### Auth

On load: check `supabase.auth.getSession()`. If no session → show login form (email + password). On successful login → show dashboard. Logout button clears session.

**No signup UI.** The admin user is created manually via the Supabase dashboard (Authentication → Users → Add user). This is documented in README so the deployed admin page cannot be used to create new accounts.

### Tumblr connect flow

1. "Connect Tumblr" button → admin.js builds Tumblr OAuth2 authorization URL (PKCE, state nonce stored in sessionStorage) → `window.location.href = authUrl`.
2. Tumblr redirects back to `admin.html?code=...&state=...`.
3. admin.js detects `?code=` param → validates state → calls `tumblr-token-exchange` Edge Function.
4. Stores returned `access_token` in `localStorage['tumblr_token']` and
   `primary_blog_name` in `localStorage['tumblr_blog_name']`.
5. Button becomes `Tumblr Connected as @{primary_blog_name}`. If
   `primary_blog_name` does not match the `TUMBLR_BLOG_IDENTIFIER` secret
   (stripped of `.tumblr.com`), an inline warning appears: "⚠ Connected account
   differs from TUMBLR_BLOG_IDENTIFIER — posts may fail." (Still allowed; token
   may grant access to secondary blogs.)

### Submissions table

Newest first. Columns: Date, Name, Contact, Size, Status badge, Actions.

**Contact column** shows a text-label prefix: `Tumblr: @handle` or `Email: a@b.co`.

**Duplicate flag:** when rendering rows, admin.js scans for submissions with the
same `contact_type + contact_value` appearing more than once in the last 24 h
and shows a small `⚠ duplicate` badge next to the contact cell on all but the
first occurrence. No blocking behaviour — purely informational.

| Status | Badge color | Primary action | Always-available actions |
|---|---|---|---|
| pending | grey | — (waiting on Edge Function) | **View picks**, **Regenerate**, **Delete PNG** |
| generating | yellow / spinner | — | **View picks**, **Regenerate** (use if stuck > 2 min) |
| ready | green | **Send** | **View picks**, **Regenerate**, **Preview**, **Delete PNG** |
| sent | blue | **Resend** | **View picks**, **Regenerate**, **Preview**, **Delete PNG** |
| error | red | **Regenerate** (error message shown) | **View picks**, **Delete PNG** |

**Regenerate is always available** on every row. This provides a recovery path for rows stuck in `pending` or `generating` due to silent Edge Function failures.

**Error visibility:** errors surface inline only.
- Generate failures → `error_message` text shown next to the red `error` badge in the Status cell.
- Send failures (other than `TUMBLR_TOKEN_EXPIRED`) → inline text under the Send/Resend button.
- No separate error-log panel. For deeper debugging the admin opens **Supabase Dashboard → Edge Functions → Logs**.

**View picks:** clicking the View button inserts a second `<tr class="picks-row">`
immediately below the submission row, containing the checked options grouped by
question label (same format as the respondent's thank-you summary). Picks are
fetched **on demand** — one `SELECT * FROM submission_picks WHERE submission_id = X`
per click, then cached on the row so subsequent toggles are instant. Clicking
View again collapses the expanded row.

**Orphan picks (schema evolution):** when grouping picks, `question_id` is looked
up in the current `SURVEY_QUESTIONS`. If the question was renamed or removed
after submission time, its picks are gathered under a bucket labeled
`Other (removed question)`. The stored `option_text` is always used verbatim,
so the text itself survives. Same logic applies in `survey.js`'s post-submit
thank-you summary (though that's unlikely to hit it — the submit happens from
the same page load that loaded `SURVEY_QUESTIONS`).

**Send:** disables the button, changes text to "Sending…", calls `send-card` Edge Function with `submission_id` + window globals (`CARD_TAGS`, `CARD_FROM_NAME`, `CARD_FROM_EMAIL`, `CARD_REPLY_TO`, `CARD_EMAIL_SUBJECT`, `CARD_EMAIL_BODY`) + `tumblr_token` from localStorage. On success: full-page reload. On failure: show inline error; re-enable the button.

- If the function returns `{ error: 'TUMBLR_TOKEN_EXPIRED' }`: show a banner "Your Tumblr connection expired — click to reconnect" which re-runs the Tumblr OAuth flow. After reconnect, admin clicks Send again.
- If Tumblr is required but `localStorage['tumblr_token']` is missing: show "Connect Tumblr first" inline.

**Preview:** generates a 1-hour Supabase Storage signed URL for `cards/{id}.png` and opens it in a new tab.

**Regenerate:** calls `generate-card` Edge Function directly (HTTP invoke), resets `gen_attempts = 0`, `card_status = 'pending'` so the function can re-run cleanly. The button disables for the duration of the request to prevent rapid double-clicks. If a webhook-triggered run and a manual regen run overlap, the last Storage upload wins — safe because the deterministic seed produces identical PNGs.

**Resend:** calls `send-card` again for already-sent submissions (useful if the first send failed silently or the recipient didn't receive it).

**Delete PNG:** deletes `cards/{id}.png` from Supabase Storage and resets `card_storage_path = null`, `card_status = 'pending'` on the DB row. The submission row itself is kept. Card can be regenerated via the Regenerate action.

### Empty state

If no submissions exist, the table area shows: "No submissions yet. Share your form URL to start collecting!"

---

## `survey-data.js` constants

```js
window.FREE_CELL_TEXT        = 'FREE';                  // center cell label for Mini + Standard
window.CARD_TAGS             = ['bingo'];               // Tumblr post tags
window.CARD_TUMBLR_CAPTION   = "@{handle} here's your bingo card!"; // {handle}, {name}
window.CARD_TUMBLR_POST_STATE = 'published';            // 'published' | 'queue' | 'draft'
window.CARD_FROM_NAME        = 'Bingo Generator';       // Email display name
window.CARD_FROM_EMAIL       = 'you@example.com';       // Resend "from" address (must be verified)
window.CARD_REPLY_TO         = '';                      // Optional personal Reply-To. Empty = omit header.
window.CARD_EMAIL_SUBJECT    = "{name}, here's your bingo card!"; // {name} = respondent_name
window.CARD_EMAIL_BODY       = "Hey {name}, here's your bingo card!"; // {name} = respondent_name
// SURVEY_QUESTIONS array unchanged from v2 ...
```

All `CARD_*` constants are read by `admin.js` from `window` and passed to the `send-card` Edge Function at call time — they are **not** Supabase secrets. `FREE_CELL_TEXT` IS a Supabase secret so the Edge Function can use it without reading the JS file.

---

## Supabase project secrets

Set in Supabase Dashboard → Settings → Edge Functions → Secrets.

| Secret | Used by | Notes |
|---|---|---|
| `TUMBLR_CLIENT_ID` | tumblr-token-exchange | From Tumblr app registration |
| `TUMBLR_CLIENT_SECRET` | tumblr-token-exchange | From Tumblr app registration |
| `TUMBLR_BLOG_IDENTIFIER` | send-card | e.g. `yourblog.tumblr.com` |
| `RESEND_API_KEY` | send-card | Resend free tier |
| `FREE_CELL_TEXT` | generate-card | Must match `FREE_CELL_TEXT` in survey-data.js |
| `SUPABASE_SERVICE_ROLE_KEY` | generate-card, send-card | Auto-injected by Supabase runtime |

---

## File layout

```
bingo-generator/
├── index.html                # survey form
├── admin.html                # admin dashboard
├── styles.css                # form + admin styles
├── config.js                 # SUPABASE_URL + SUPABASE_ANON_KEY
├── config.example.js
├── survey-data.js            # questions, options, FREE_CELL_TEXT + CARD_* email/Tumblr constants
├── survey.js                 # form render, validation, INSERT, post-submit view
├── admin.js                  # auth, submissions table, send/retry, Tumblr OAuth
├── README.md                 # Supabase setup, Edge Function deploy, secrets, Tumblr app setup
└── supabase/
    └── functions/
        ├── generate-card/
        │   ├── index.ts
        │   ├── Inter-Regular.ttf         # primary font (Latin)
        │   ├── Inter-Bold.ttf            # FREE cell + emphasis
        │   └── NotoSans-Regular.ttf      # fallback for non-Latin glyphs
        ├── send-card/
        │   └── index.ts
        └── tumblr-token-exchange/
            └── index.ts
```

## Visual styling

`styles.css` should match the admin's Tumblr blog aesthetic. The deployer provides a color palette or screenshot reference before styling begins; `styles.css` picks up a small set of CSS custom properties (`--bg`, `--surface`, `--text`, `--accent`, `--accent-contrast`, `--border`, `--error`) so palette tweaks don't require broad edits.

Dark mode is the default for indie/Tumblr contexts. Rounded corners, soft borders, and a warm/playful tone are expected unless the blog reference contradicts. The form and admin page use the same palette for consistency.

---

## Verification

1. Follow README: create Supabase project, run SQL, create `cards` storage bucket, deploy 3 Edge Functions, set all secrets, configure DB Webhook (submissions INSERT → generate-card).
2. Create admin user via Supabase dashboard Auth tab.
3. Open `admin.html` — login form shows; unauthenticated users see only the login form.
4. Log in → dashboard shows empty submissions table.
5. Click "Connect Tumblr" → OAuth flow runs → "Tumblr Connected ✓".
6. Open `index.html`. Verify form has Name, contact-type radio, conditional input, size radios, questions.
7. Select "Tumblr", enter a handle, pick Mini, check 8+ options, submit.
8. Post-submit: form hides, thank-you message shows, checked options listed by question. No card visible.
9. In Supabase dashboard: `submissions` has one row, `submission_picks` has N rows, contact_type = 'tumblr'.
10. Within seconds `card_status` changes to 'generating' then 'ready'. `card_storage_path` populated.
11. Admin page (after refresh) shows new row with green "ready" badge. Click "Preview" → card PNG opens: Mini (3×3) grid, crisp borders, FREE center cell, no name/title/footer.
12. Click "Send" → status changes to 'sent'; `sent_at` set.
13. Check Tumblr blog — photo post exists with card image, "@handle here's your bingo card!" caption, CARD_TAGS tags applied, and image alt text = cell contents joined by " · ".
14. Submit with Tumblr handle typed as `@name.tumblr.com` → DB row stores `name` (normalized).
15. Submit again with "Email" contact type. Confirm email arrives with card PNG attached, `from` = "{CARD_FROM_NAME} <{CARD_FROM_EMAIL}>", subject matches CARD_EMAIL_SUBJECT with `{name}` substituted, body matches CARD_EMAIL_BODY, Reply-To = CARD_REPLY_TO if set.
16. Simulate generation failure (temporarily revoke Storage access) → submit form → after 3 retries card_status = 'error', error_message visible in admin. Restore access, click "Regenerate" → card generates successfully.
17. Click "Resend" on a 'sent' row → Tumblr post fires again.
18. Click "Delete PNG" on a 'sent' row → Storage file removed; row resets to 'pending'; card can be regenerated.
19. Simulate a stuck row (manually set card_status = 'generating' and leave it) → click "Regenerate" on the stuck row → status resets to 'pending' and the Edge Function re-runs, producing 'ready'.
20. Invalidate the stored Tumblr token (overwrite localStorage or revoke in Tumblr app settings) → click Send on a Tumblr row → banner shows "Your Tumblr connection expired — click to reconnect"; reconnect flow succeeds; Send works on retry.
21. Click Send → button disables, label changes to "Sending…" during the request, page reloads on success and the row badge is blue (sent).
22. Submit Standard card (≥24 picks) → preview shows 5×5 US-Letter PNG rendered with Inter font (Regular for cells, Bold for FREE).
23. Submit Nano card (≥3 picks) → preview shows 1200×400 banner PNG.
24. Submit with fewer picks than required for chosen size → inline error blocks submit; no DB rows created.
25. Resize `index.html` to 375 px → form, counter, questions all usable.
26. Fill the hidden honeypot field via DevTools before submit → submit handler silently no-ops (no row inserted).
27. After connecting Tumblr, the Connect button reads `Tumblr Connected as @yourblog`. If `TUMBLR_BLOG_IDENTIFIER` differs from the authorized primary blog, the inline mismatch warning shows.
28. Send a card while `CARD_TUMBLR_POST_STATE = 'queue'` → Tumblr post appears in the blog's queue (not public yet); `card_status` still flips to `sent`.
29. Submit two rows with the same Tumblr handle within 24 h → admin table shows `⚠ duplicate` next to the later row's contact cell.
30. Click View on any row → a second `<tr>` expands below with picks grouped by question; click View again → collapses.
31. Option text containing CJK or accented chars renders via NotoSans-Regular.ttf fallback without tofu boxes.
32. The page's `<div id="logo">` is empty on fresh deploy and takes no visible space; dropping an `<img>` inside it shows a logo at the top of the page.
33. Card PNG preview shows a 6 px gap between cells with rounded corners (`rx=8`); no shared borders.
34. Regenerating a card (e.g., after Delete PNG) produces byte-identical cell ordering to the previous generation (seeded by submission_id).
35. Rename or remove a question in `survey-data.js` after submissions exist → the affected submission's View picks panel shows those picks under `Other (removed question)` without error.
36. Manually INSERT a duplicate `(submission_id, option_id)` row in `submission_picks`, then Regenerate → the rendered card shows that option only once (dedupe ran before shuffle).
37. Load either page with JavaScript disabled → the `<noscript>` banner is visible and no other content responds to input.
38. `curl -sI https://{site}/admin.html` returns an HTML body with `<meta name="robots" content="noindex,nofollow">`; same for `index.html`.
39. A Mini cell with a very long option text truncates with `…` at a font size no smaller than 24 px (verify by inspecting the SVG or measuring the rendered PNG).
40. Reload either page on a throttled (Slow 3G) connection → the inline `Loading…` placeholders appear briefly, then get replaced by content.
41. Upload all static files to Neocities, repeat steps 6–40 against the live URL.

---

## Visual palette (from screenshot)

| Token | Value | Notes |
|---|---|---|
| `--bg` | `#120a1f` | Near-black purple |
| `--surface` | `#1e1033` | Dark purple cards |
| `--surface-2` | `#2a1a4e` | Slightly lighter surface |
| `--text` | `#e8d5f5` | Light lavender |
| `--text-muted` | `#9d88c0` | Subdued labels |
| `--accent` | `#8b5cf6` | Bright violet |
| `--accent-hover` | `#7c3aed` | Hover state |
| `--accent-contrast` | `#ffffff` | Text on accent |
| `--border` | `#3d2060` | Subtle border |
| `--error` | `#f87171` | Red on dark |
| `--success` | `#34d399` | Green badge |
| `--warning` | `#fbbf24` | Yellow badge |
| `--info` | `#60a5fa` | Blue badge (sent) |

---

## Key implementation decisions

### survey-data.js structure
```js
window.SURVEY_QUESTIONS = [
  { id: 'q1', label: 'Question label', options: [
    { id: 'q1o1', text: 'Option text' },
    ...
  ] },
  ...
];
// + FREE_CELL_TEXT, CARD_TAGS, CARD_FROM_NAME, CARD_FROM_EMAIL,
//   CARD_REPLY_TO, CARD_EMAIL_SUBJECT, CARD_EMAIL_BODY
```
Questions are **placeholder examples** — user replaces with real content.

### Supabase client
Both HTML files load `@supabase/supabase-js@2` via CDN script tag.
`config.js` calls `supabase.createClient(...)` and stores on `window.supabaseClient`.
Admin uses the same client; Supabase Auth automatically attaches the JWT to requests.

Script load order in each HTML file:
1. Supabase CDN (`@supabase/supabase-js@2` UMD build — gives `supabase` global)
2. `config.js` (sets SUPABASE_URL, ANON_KEY, TUMBLR_CLIENT_ID; creates `window.supabaseClient`)
3. `survey-data.js` (sets questions, CARD_* constants)
4. `survey.js` or `admin.js`

### Race condition: picks vs. webhook
DB Webhook fires on `submissions` INSERT **before** picks are inserted by the client.
Fix: `generate-card` polls for picks up to 5 × 1 s before proceeding.

```ts
let picks = [];
for (let i = 0; i < 5; i++) {
  const { data } = await svc.from('submission_picks').select().eq('submission_id', id);
  if (data && data.length >= minPicks) { picks = data; break; }
  await sleep(1000);
}
```

### generate-card: dual-trigger support
Webhook body: `{ type, record: { id, ... } }`
Direct admin invoke (Regenerate): `{ submission_id: 'uuid' }`
Resolution: `const submissionId = body.record?.id ?? body.submission_id;`

### SVG card dimensions

| Size | Canvas (px) | Grid | Margin | Cell (px) |
|---|---|---|---|---|
| Nano | 1200×400 | 1×3 | 40 | ≈373×320 |
| Mini | 1275×1650 | 3×3 | 75 | 375×500 |
| Standard | 1275×1650 | 5×5 | 75 | 225×300 |

FREE cell: center index 4 (Mini) / 12 (Standard). Nano has no FREE cell.

### SVG font metric approximation
`resvg-wasm` cannot measure text width before render. Approximation:
- Regular: `avgCharWidth ≈ fontSize * 0.52`
- Bold (FREE): `avgCharWidth ≈ fontSize * 0.58`

### resvg-wasm initialization (Deno / Supabase Edge Functions)
```ts
import { Resvg, initWasm } from 'npm:@resvg/resvg-wasm@2.6.2';

let initialized = false;
async function ensureWasm() {
  if (initialized) return;
  const res = await fetch(new URL('npm:@resvg/resvg-wasm@2.6.2/index_bg.wasm'));
  await initWasm(await res.arrayBuffer());
  initialized = true;
}
```
Fonts: `Deno.readFile(new URL('./Inter-Regular.ttf', import.meta.url))` — files live alongside `index.ts` in the `generate-card/` directory. User downloads Inter from Google Fonts.

### Tumblr NPF photo post (multipart bound media)
```
POST https://api.tumblr.com/v2/blog/{blog}/posts
Content-Type: multipart/form-data; boundary={boundary}

  --{boundary}
  Content-Disposition: form-data; name="json"
  Content-Type: application/json

  { "content": [
      { "type": "text", "text": "{CARD_TUMBLR_CAPTION with {handle}/{name} filled}" },
      { "type": "image", "media": [{ "type": "image/png", "identifier": "card" }], "alt_text": "..." }
    ],
    "tags": [...],
    "state": "{CARD_TUMBLR_POST_STATE}"       // published | queue | draft
  }
  --{boundary}
  Content-Disposition: form-data; name="card"; filename="card.png"
  Content-Type: image/png

  [binary PNG]
  --{boundary}--
```
Alt text = all cell contents joined by ` · ` (picks in shuffle order).
If API returns 401 → `{ ok: false, error: 'TUMBLR_TOKEN_EXPIRED' }`.

### Tumblr PKCE flow (admin.js)
```js
const verifier = base64url(crypto.getRandomValues(new Uint8Array(64)));
const challenge = base64url(new Uint8Array(
  await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
));
sessionStorage.setItem('tumblr_pkce', JSON.stringify({ verifier, state }));
// Redirect URI = window.location.origin + window.location.pathname
```
This redirect URI must be registered in the Tumblr app's allowed callback URLs.

### Admin table rendering
Single `renderSubmissions(rows)` function rebuilds `<tbody>` innerHTML from scratch on each load/reload. No pagination in v1.

Status → badge class: `.badge-pending` (grey) · `.badge-generating` (yellow) · `.badge-ready` (green) · `.badge-sent` (blue) · `.badge-error` (red).

Contact cell renders as `Tumblr: @{handle}` or `Email: {value}` plain text —
no icons, no emoji. A `⚠ duplicate` inline badge appears after the contact text
on any row whose `contact_type + contact_value` matches a prior row within the
last 24 h (dedupe scan runs once over `rows` during render, marking indices).

View picks expansion:
```
handleViewClick(id):
  const existing = tbody.querySelector(`.picks-row[data-for="${id}"]`)
  if existing: existing.remove(); return
  const picks = await supabaseClient
    .from('submission_picks').select('*').eq('submission_id', id)
  const html = buildPicksGrouped(picks.data)   // same helper as thank-you
  rowAfter(id).insertAdjacentHTML('afterend',
    `<tr class="picks-row" data-for="${id}"><td colspan="6">${html}</td></tr>`)
```

### Send button flow
1. Disable button, set text to "Sending…"
2. `const { data: { session } } = await supabaseClient.auth.getSession()`
3. POST to `{SUPABASE_URL}/functions/v1/send-card` with `Authorization: Bearer {session.access_token}`
4. `{ ok: true }` → `window.location.reload()`
5. `{ error: 'TUMBLR_TOKEN_EXPIRED' }` → clear localStorage token, show reconnect banner
6. Other error → show inline error, re-enable button

---

## Out of scope (v1)

- Client-side card preview or download by respondents (removed by design).
- URL-shareable card hash (removed by design).
- Bulk send (send all ready submissions at once).
- Scheduled auto-send cron (cards sent without admin click).
- Tumblr DM — not supported by Tumblr API; replaced by @mention post.
- Multi-admin support / admin signup on admin.html (admin created via Supabase dashboard only).
- Respondent edit / delete of their own submission (no self-serve data deletion in v1).
- Admin UI deletion of a full submission row (use Supabase dashboard for cleanup).
- Respondent draft auto-save (reload loses form progress).
- Respondent submission confirmation email (the in-page thank-you is the ack).
- Privacy notice / data-retention policy on the form.
- CAPTCHA or rate limit (honeypot only; sophisticated bots will bypass it).
- Admin notification of new submissions (admin checks periodically).
- Tumblr refresh-token auto-renewal (manual reconnect on 401 instead).
- Admin page filtering, sorting, pagination, or search.
- Inline card thumbnails in the admin table (preview via signed URL in new tab).
- Live admin updates via Supabase Realtime (manual page reload only).
- Respondent CSV export from admin page.
- Maximum picks cap (user can check all options; generator only uses first N after shuffle).
- Different card layout on Regenerate (seed stays `submission_id` so layout is deterministic).
- Auto-detect admin's primary Tumblr blog (explicit `TUMBLR_BLOG_IDENTIFIER` secret only;
  primary blog is surfaced for verification but not auto-used as target).
- Tumblr post idempotency (no `tumblr_post_id` column; rare double-post on
  retry is accepted — admin deletes duplicates manually).
- Admin error-log panel / Supabase log deep-links (errors are inline only).
- Offline / retry UX on submission failure (user just re-submits manually).
- i18n; full WCAG-AA audit beyond semantic HTML + labels + aria-live.
- Multiple surveys per deployment.
