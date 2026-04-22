(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────

  let cachedRows = [];
  const picksCache = {}; // submission_id → picks array

  // ── Helpers ───────────────────────────────────────────────────────────────

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function groupPicksByQuestion(picks) {
    const questions = window.SURVEY_QUESTIONS || [];
    const qMap = {};
    questions.forEach(q => { qMap[q.id] = q.label; });
    const groups = {};
    picks.forEach(p => {
      const label = qMap[p.question_id] || 'Other (removed question)';
      if (!groups[label]) groups[label] = [];
      groups[label].push(p.option_text);
    });
    return groups;
  }

  function buildPicksPanelHTML(picks) {
    const groups = groupPicksByQuestion(picks);
    if (Object.keys(groups).length === 0) return '<p>No picks recorded.</p>';
    let html = '<div class="picks-panel">';
    for (const [label, texts] of Object.entries(groups)) {
      html += `<p class="question-label">${escapeHtml(label)}</p><ul>`;
      texts.forEach(t => { html += `<li>${escapeHtml(t)}</li>`; });
      html += '</ul>';
    }
    html += '</div>';
    return html;
  }

  // Detect duplicate contacts within the last 24 h, return Set of duplicate row ids
  function detectDuplicates(rows) {
    const dupeIds = new Set();
    const seen    = {}; // key → first-seen id
    const cutoff  = Date.now() - 24 * 60 * 60 * 1000;
    // rows are newest-first; reverse to process oldest-first for "first occurrence" semantics
    const sorted = [...rows].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    sorted.forEach(row => {
      if (new Date(row.created_at).getTime() < cutoff) return;
      const key = `${row.contact_type}:${row.contact_value.toLowerCase()}`;
      if (seen[key]) {
        dupeIds.add(row.id);
      } else {
        seen[key] = row.id;
      }
    });
    return dupeIds;
  }

  // ── Badge + action rendering ──────────────────────────────────────────────

  function statusBadge(status, errorMsg) {
    let html = `<span class="badge badge-${status}">${escapeHtml(status)}</span>`;
    if (status === 'error' && errorMsg) {
      html += `<p class="error-msg">${escapeHtml(errorMsg)}</p>`;
    }
    return html;
  }

  function actionsHTML(row) {
    const id     = row.id;
    const status = row.card_status;
    const hasCard = !!row.card_storage_path;
    let html = '<div class="action-group">';

    // Primary action
    if (status === 'ready') {
      html += `<button class="btn btn-sm" data-action="send" data-id="${id}">Send</button>`;
    } else if (status === 'sent') {
      html += `<button class="btn btn-sm btn-ghost" data-action="send" data-id="${id}">Resend</button>`;
    } else if (status === 'error') {
      html += `<button class="btn btn-sm" data-action="regen" data-id="${id}">Regenerate</button>`;
    }

    // Always available
    html += `<button class="btn btn-sm btn-ghost" data-action="view" data-id="${id}">View picks</button>`;

    if (status !== 'error') {
      html += `<button class="btn btn-sm btn-ghost" data-action="regen" data-id="${id}">Regenerate</button>`;
    }

    if (hasCard) {
      html += `<button class="btn btn-sm btn-ghost" data-action="preview" data-id="${id}">Preview</button>`;
      html += `<button class="btn btn-sm btn-danger" data-action="delete-png" data-id="${id}">Delete PNG</button>`;
    }

    html += '</div>';
    // Placeholder for inline errors under action buttons
    html += `<p class="inline-error" id="action-error-${id}"></p>`;
    return html;
  }

  // ── Table render ──────────────────────────────────────────────────────────

  function renderSubmissions(rows) {
    const tbody     = document.getElementById('submissions-tbody');
    const tableWrap = document.getElementById('table-wrapper');
    const emptyEl   = document.getElementById('empty-state');
    const loadingEl = document.getElementById('submissions-loading');

    loadingEl.style.display = 'none';
    tableWrap.style.display = 'block';

    if (rows.length === 0) {
      tbody.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }

    emptyEl.style.display = 'none';
    const dupeIds = detectDuplicates(rows);

    let html = '';
    rows.forEach(row => {
      const isDupe = dupeIds.has(row.id);
      const contactPrefix = row.contact_type === 'tumblr'
        ? `Tumblr: @${escapeHtml(row.contact_value)}`
        : `Email: ${escapeHtml(row.contact_value)}`;
      const dupeBadge = isDupe
        ? ' <span class="badge badge-duplicate">⚠ duplicate</span>'
        : '';

      html += `<tr data-id="${row.id}">
        <td>${escapeHtml(formatDate(row.created_at))}</td>
        <td>${escapeHtml(row.respondent_name)}</td>
        <td>${contactPrefix}${dupeBadge}</td>
        <td>${escapeHtml(row.card_size)}</td>
        <td>${statusBadge(row.card_status, row.error_message)}</td>
        <td>${actionsHTML(row)}</td>
      </tr>`;
    });

    tbody.innerHTML = html;
    cachedRows = rows;
  }

  // ── Data fetch ────────────────────────────────────────────────────────────

  async function loadSubmissions() {
    const loadingEl = document.getElementById('submissions-loading');
    loadingEl.style.display = 'block';
    document.getElementById('table-wrapper').style.display = 'none';

    const { data, error } = await window.supabaseClient
      .from('submissions')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      loadingEl.textContent = `Error loading submissions: ${error.message}`;
      return;
    }

    renderSubmissions(data || []);
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  function setActionError(id, msg) {
    const el = document.getElementById(`action-error-${id}`);
    if (el) el.textContent = msg;
  }

  async function handleSend(id) {
    const row = cachedRows.find(r => r.id === id);
    if (!row) return;

    if (row.contact_type === 'tumblr') {
      const token = localStorage.getItem('tumblr_token');
      if (!token) {
        setActionError(id, 'Connect Tumblr first before sending.');
        return;
      }
    }

    // Disable send button for this row
    const btn = document.querySelector(`[data-action="send"][data-id="${id}"]`);
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    setActionError(id, '');

    const { data: { session } } = await window.supabaseClient.auth.getSession();

    const body = {
      submission_id:          id,
      tumblr_token:           localStorage.getItem('tumblr_token') || undefined,
      card_tags:              window.CARD_TAGS,
      tumblr_caption_template: window.CARD_TUMBLR_CAPTION,
      tumblr_post_state:      window.CARD_TUMBLR_POST_STATE,
      from_name:              window.CARD_FROM_NAME,
      from_email:             window.CARD_FROM_EMAIL,
      reply_to:               window.CARD_REPLY_TO,
      email_subject_template: window.CARD_EMAIL_SUBJECT,
      email_body_template:    window.CARD_EMAIL_BODY,
    };

    let result;
    try {
      const resp = await fetch(
        `${window.SUPABASE_URL}/functions/v1/send-card`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(body),
        }
      );
      result = await resp.json();
    } catch (err) {
      setActionError(id, `Network error: ${err.message}`);
      if (btn) { btn.disabled = false; btn.textContent = row.card_status === 'sent' ? 'Resend' : 'Send'; }
      return;
    }

    if (result.ok) {
      window.location.reload();
      return;
    }

    if (result.error === 'TUMBLR_TOKEN_EXPIRED') {
      localStorage.removeItem('tumblr_token');
      localStorage.removeItem('tumblr_blog_name');
      showReconnectBanner();
      setActionError(id, 'Tumblr token expired. Reconnect above, then try again.');
    } else {
      setActionError(id, result.error || 'Send failed. Try again.');
    }

    if (btn) { btn.disabled = false; btn.textContent = row.card_status === 'sent' ? 'Resend' : 'Send'; }
  }

  async function handleRegen(id) {
    const btn = document.querySelector(`[data-action="regen"][data-id="${id}"]`);
    if (btn) { btn.disabled = true; btn.textContent = 'Regenerating…'; }
    setActionError(id, '');

    const { data: { session } } = await window.supabaseClient.auth.getSession();

    try {
      const resp = await fetch(
        `${window.SUPABASE_URL}/functions/v1/generate-card`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ submission_id: id }),
        }
      );
      const result = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setActionError(id, result.error || 'Regenerate failed.');
        if (btn) { btn.disabled = false; btn.textContent = 'Regenerate'; }
        return;
      }
    } catch (err) {
      setActionError(id, `Network error: ${err.message}`);
      if (btn) { btn.disabled = false; btn.textContent = 'Regenerate'; }
      return;
    }

    window.location.reload();
  }

  async function handlePreview(id) {
    const { data, error } = await window.supabaseClient.storage
      .from('cards')
      .createSignedUrl(`${id}.png`, 3600);

    if (error) {
      setActionError(id, `Preview failed: ${error.message}`);
      return;
    }

    window.open(data.signedUrl, '_blank');
  }

  async function handleDeletePng(id) {
    if (!confirm('Delete the card PNG? The submission row is kept and the card can be regenerated.')) return;

    const { error: storErr } = await window.supabaseClient.storage
      .from('cards')
      .remove([`${id}.png`]);

    if (storErr) {
      setActionError(id, `Delete failed: ${storErr.message}`);
      return;
    }

    const { error: dbErr } = await window.supabaseClient
      .from('submissions')
      .update({ card_storage_path: null, card_status: 'pending' })
      .eq('id', id);

    if (dbErr) {
      setActionError(id, `Storage deleted but DB update failed: ${dbErr.message}`);
      return;
    }

    window.location.reload();
  }

  async function handleViewPicks(id, triggerBtn) {
    const tbody  = document.getElementById('submissions-tbody');
    const existing = tbody.querySelector(`.picks-row[data-for="${id}"]`);

    if (existing) {
      existing.remove();
      triggerBtn.textContent = 'View picks';
      return;
    }

    triggerBtn.disabled    = true;
    triggerBtn.textContent = 'Loading…';

    let picks;
    if (picksCache[id]) {
      picks = picksCache[id];
    } else {
      const { data, error } = await window.supabaseClient
        .from('submission_picks')
        .select('*')
        .eq('submission_id', id);

      if (error) {
        triggerBtn.disabled    = false;
        triggerBtn.textContent = 'View picks';
        setActionError(id, `Failed to load picks: ${error.message}`);
        return;
      }

      picks = data || [];
      picksCache[id] = picks;
    }

    triggerBtn.disabled    = false;
    triggerBtn.textContent = 'Hide picks';

    const sourceRow = tbody.querySelector(`tr[data-id="${id}"]`);
    if (!sourceRow) return;

    const colCount = 6;
    const tr = document.createElement('tr');
    tr.className = 'picks-row';
    tr.dataset.for = id;
    tr.innerHTML = `<td colspan="${colCount}">${buildPicksPanelHTML(picks)}</td>`;
    sourceRow.insertAdjacentElement('afterend', tr);
  }

  // ── Table click delegation ────────────────────────────────────────────────

  function attachTableListeners() {
    document.getElementById('submissions-tbody').addEventListener('click', async e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;
      const id     = btn.dataset.id;

      if (action === 'send')       await handleSend(id);
      if (action === 'regen')      await handleRegen(id);
      if (action === 'preview')    await handlePreview(id);
      if (action === 'delete-png') await handleDeletePng(id);
      if (action === 'view')       await handleViewPicks(id, btn);
    });
  }

  // ── Tumblr OAuth ──────────────────────────────────────────────────────────

  function base64url(bytes) {
    return btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function startTumblrOAuth() {
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(64)));
    const hashBuf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = base64url(new Uint8Array(hashBuf));
    const state     = base64url(crypto.getRandomValues(new Uint8Array(16)));

    sessionStorage.setItem('tumblr_pkce', JSON.stringify({ verifier, state }));

    const redirectUri = window.location.origin + window.location.pathname;
    const params = new URLSearchParams({
      response_type:         'code',
      client_id:             window.TUMBLR_CLIENT_ID,
      redirect_uri:          redirectUri,
      scope:                 'write',
      code_challenge:        challenge,
      code_challenge_method: 'S256',
      state,
    });

    window.location.href = `https://www.tumblr.com/oauth2/authorize?${params}`;
  }

  async function finishTumblrOAuth(code, returnedState) {
    const stored = JSON.parse(sessionStorage.getItem('tumblr_pkce') || '{}');
    if (!stored.verifier || stored.state !== returnedState) {
      alert('OAuth state mismatch. Please try connecting again.');
      return;
    }

    sessionStorage.removeItem('tumblr_pkce');

    const redirectUri = window.location.origin + window.location.pathname;
    const { data: { session } } = await window.supabaseClient.auth.getSession();

    let result;
    try {
      const resp = await fetch(
        `${window.SUPABASE_URL}/functions/v1/tumblr-token-exchange`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ code, code_verifier: stored.verifier, redirect_uri: redirectUri }),
        }
      );
      result = await resp.json();
    } catch (err) {
      alert(`Tumblr connection failed: ${err.message}`);
      return;
    }

    if (!result.access_token) {
      alert('Tumblr connection failed. Please try again.');
      return;
    }

    localStorage.setItem('tumblr_token', result.access_token);
    localStorage.setItem('tumblr_blog_name', result.primary_blog_name || '');

    // Clean URL
    window.history.replaceState({}, '', window.location.pathname);

    updateTumblrButton();
  }

  function updateTumblrButton() {
    const btn          = document.getElementById('tumblr-connect-btn');
    const warning      = document.getElementById('tumblr-mismatch-warning');
    const blogName     = localStorage.getItem('tumblr_blog_name') || '';
    const token        = localStorage.getItem('tumblr_token');

    if (token && blogName) {
      btn.textContent = `Tumblr Connected as @${blogName}`;
      btn.classList.add('connected');
      warning.style.display = 'none';
      // Note: TUMBLR_BLOG_IDENTIFIER is a server-side secret; we can't compare here.
      // The mismatch warning is shown if primary_blog_name was stored empty by the exchange fn.
    } else if (token) {
      btn.textContent = 'Tumblr Connected ✓';
      btn.classList.add('connected');
    } else {
      btn.textContent = 'Connect Tumblr';
      btn.classList.remove('connected');
    }
  }

  function showReconnectBanner() {
    const banner = document.getElementById('reconnect-banner');
    banner.style.display = 'block';
  }

  // ── Login ─────────────────────────────────────────────────────────────────

  function showLogin() {
    document.getElementById('session-loading').style.display  = 'none';
    document.getElementById('login-section').style.display    = '';
    document.getElementById('dashboard-section').style.display = 'none';
  }

  function showDashboard() {
    document.getElementById('session-loading').style.display  = 'none';
    document.getElementById('login-section').style.display    = 'none';
    document.getElementById('dashboard-section').style.display = '';
  }

  async function handleLogin(e) {
    e.preventDefault();
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl    = document.getElementById('login-error');
    const btn      = document.getElementById('login-btn');

    errEl.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Logging in…';

    const { error } = await window.supabaseClient.auth.signInWithPassword({ email, password });

    if (error) {
      errEl.textContent   = error.message;
      errEl.style.display = 'block';
      btn.disabled        = false;
      btn.textContent     = 'Log in';
      return;
    }

    showDashboard();
    initDashboard();
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  function initDashboard() {
    loadSubmissions();
    attachTableListeners();
    updateTumblrButton();

    document.getElementById('refresh-btn').addEventListener('click', loadSubmissions);
    document.getElementById('logout-btn').addEventListener('click', async () => {
      await window.supabaseClient.auth.signOut();
      showLogin();
    });

    const connectBtn = document.getElementById('tumblr-connect-btn');
    connectBtn.addEventListener('click', () => {
      if (localStorage.getItem('tumblr_token')) {
        // Already connected — clicking again starts reconnect
        localStorage.removeItem('tumblr_token');
        localStorage.removeItem('tumblr_blog_name');
      }
      startTumblrOAuth();
    });

    const reconnectBanner = document.getElementById('reconnect-banner');
    reconnectBanner.addEventListener('click', startTumblrOAuth);
    reconnectBanner.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') startTumblrOAuth();
    });
  }

  async function init() {
    const supa = window.supabaseClient;

    // Handle Tumblr OAuth return
    const urlParams = new URLSearchParams(window.location.search);
    const code  = urlParams.get('code');
    const state = urlParams.get('state');

    const { data: { session } } = await supa.auth.getSession();

    if (!session) {
      showLogin();
      document.getElementById('login-form').addEventListener('submit', handleLogin);
      // If we have an OAuth code but are not logged in, still need to log in first
      // Preserve the code in sessionStorage in case they just arrived from OAuth
      if (code && state) {
        sessionStorage.setItem('pending_tumblr_code', JSON.stringify({ code, state }));
        window.history.replaceState({}, '', window.location.pathname);
      }
      return;
    }

    showDashboard();
    initDashboard();

    // Process any pending OAuth code (after returning from Tumblr)
    if (code && state) {
      window.history.replaceState({}, '', window.location.pathname);
      await finishTumblrOAuth(code, state);
    } else {
      const pending = sessionStorage.getItem('pending_tumblr_code');
      if (pending) {
        sessionStorage.removeItem('pending_tumblr_code');
        const { code: c, state: s } = JSON.parse(pending);
        await finishTumblrOAuth(c, s);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
