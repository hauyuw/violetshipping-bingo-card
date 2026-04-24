(function () {
  'use strict';

  // ── Helpers ───────────────────────────────────────────────────────────────

  const MIN_PICKS = { nano: 3, mini: 8, standard: 24 };
  const SIZE_LABEL = { nano: 'Nano', mini: 'Mini', standard: 'Standard' };

  function normalizeTumblr(raw) {
    let v = raw.trim().toLowerCase();
    v = v.replace(/^https?:\/\//i, '');
    v = v.replace(/\.tumblr\.com\/?$/, '');
    v = v.replace(/^@/, '');
    v = v.replace(/\/$/, '');
    return v;
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

  function buildPicksSummaryHTML(picks) {
    const groups = groupPicksByQuestion(picks);
    if (Object.keys(groups).length === 0) return '<p>No picks recorded.</p>';
    let html = '';
    for (const [label, texts] of Object.entries(groups)) {
      html += `<p class="question-label">${escapeHtml(label)}</p><ul>`;
      texts.forEach(t => { html += `<li>${escapeHtml(t)}</li>`; });
      html += '</ul>';
    }
    return html;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Render questions ──────────────────────────────────────────────────────

  function renderQuestions() {
    const container = document.getElementById('questions-container');
    const loading   = document.getElementById('questions-loading');
    const questions = window.SURVEY_QUESTIONS || [];

    loading.style.display = 'none';

    if (questions.length === 0) {
      container.innerHTML = '<p class="loading">No questions configured.</p>';
      return;
    }

    questions.forEach(q => {
      const section = document.createElement('div');
      section.className = 'form-section';

      const group = document.createElement('div');
      group.className = 'checkbox-group';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', q.label);

      const headingRow = document.createElement('div');
      headingRow.className = 'section-heading-row';
      const heading = document.createElement('h3');
      heading.textContent = q.label;
      headingRow.appendChild(heading);
      const toggleAllBtn = document.createElement('button');
      toggleAllBtn.type = 'button';
      toggleAllBtn.className = 'toggle-all-btn';
      toggleAllBtn.textContent = 'Deselect all';
      toggleAllBtn.addEventListener('click', () => {
        const boxes = group.querySelectorAll('input[type="checkbox"]');
        const anyChecked = Array.from(boxes).some(c => c.checked);
        boxes.forEach(c => { c.checked = !anyChecked; });
        toggleAllBtn.textContent = anyChecked ? 'Select all' : 'Deselect all';
        updatePicksCounter();
      });
      headingRow.appendChild(toggleAllBtn);
      section.appendChild(headingRow);

      const COLLAPSE_THRESHOLD = 10;
      const shouldCollapse = q.options.length > COLLAPSE_THRESHOLD;

      q.options.forEach((opt, idx) => {
        const row = document.createElement('div');
        row.className = 'option-row';

        const lbl = document.createElement('label');
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.name = `option_${opt.id}`;
        chk.value = opt.id;
        chk.dataset.questionId = q.id;
        chk.dataset.optionText = opt.text;
        chk.checked = true;
        chk.addEventListener('change', updatePicksCounter);

        lbl.appendChild(chk);
        lbl.appendChild(document.createTextNode(' ' + opt.text));
        row.appendChild(lbl);

        if (opt.desc) {
          const tip = document.createElement('span');
          tip.className = 'opt-tip';
          tip.setAttribute('data-tooltip', opt.desc);
          tip.setAttribute('tabindex', '0');
          tip.setAttribute('aria-label', opt.desc);
          tip.textContent = '?';
          row.appendChild(tip);
          attachTipListener(tip);
        }

        if (shouldCollapse && idx >= COLLAPSE_THRESHOLD) {
          row.classList.add('hidden-options');
        }
        group.appendChild(row);
      });

      section.appendChild(group);

      if (shouldCollapse) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'show-more-btn';
        btn.textContent = `Show all ${q.options.length} options`;
        btn.addEventListener('click', () => {
          const hidden = group.querySelectorAll('.hidden-options');
          const expanded = btn.dataset.expanded === 'true';
          hidden.forEach(el => el.classList.toggle('expanded', !expanded));
          btn.dataset.expanded = String(!expanded);
          btn.textContent = expanded
            ? `Show all ${q.options.length} options`
            : 'Show fewer options';
        });
        section.appendChild(btn);
      }

      container.appendChild(section);
    });
  }

  // ── Tooltips ──────────────────────────────────────────────────────────────

  let tooltipEl  = null;
  let activeTip  = null;

  function getTooltipEl() {
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'tooltip-bubble';
      tooltipEl.setAttribute('role', 'tooltip');
      document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
  }

  function showTooltip(target) {
    const text = target.getAttribute('data-tooltip');
    if (!text) return;

    const bubble = getTooltipEl();
    bubble.textContent = text;

    const rect   = target.getBoundingClientRect();
    const W      = 200;
    const gap    = 8;
    const margin = 8;

    let left = rect.left + rect.width / 2 - W / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - W - margin));

    bubble.style.width = W + 'px';
    bubble.style.left  = left + 'px';

    if (rect.top >= 80) {
      bubble.style.top    = '';
      bubble.style.bottom = (window.innerHeight - rect.top + gap) + 'px';
    } else {
      bubble.style.bottom = '';
      bubble.style.top    = (rect.bottom + gap) + 'px';
    }

    bubble.classList.add('visible');
    activeTip = target;
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.classList.remove('visible');
    activeTip = null;
  }

  function setupTooltips() {
    // Click anywhere outside an opt-tip closes the tooltip
    document.addEventListener('click', hideTooltip);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { hideTooltip(); return; }
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('opt-tip')) {
        e.preventDefault();
        if (e.target === activeTip) { hideTooltip(); } else { showTooltip(e.target); }
      }
    });

    window.addEventListener('scroll', hideTooltip, { passive: true });
  }

  function attachTipListener(tip) {
    tip.addEventListener('click', e => {
      // preventDefault stops the parent <label> from forwarding the click to the checkbox.
      // stopPropagation stops the document "click outside" handler from immediately hiding the tooltip.
      e.preventDefault();
      e.stopPropagation();
      if (tip === activeTip) { hideTooltip(); } else { showTooltip(tip); }
    });
  }

  // ── Picks counter ─────────────────────────────────────────────────────────

  function getSelectedSize() {
    const checked = document.querySelector('input[name="card_size"]:checked');
    return checked ? checked.value : 'mini';
  }

  function updatePicksCounter() {
    const size    = getSelectedSize();
    const needed  = MIN_PICKS[size];
    const checked = document.querySelectorAll('input[type="checkbox"][data-question-id]:checked');
    const count   = checked.length;
    document.getElementById('picks-count').textContent  = count;
    document.getElementById('picks-needed').textContent = needed;
    document.getElementById('picks-label').textContent  = SIZE_LABEL[size] || size;
  }

  // ── Validation ────────────────────────────────────────────────────────────

  function showError(id, msg) {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
  }

  function clearErrors() {
    ['name-error', 'contact-error', 'picks-error'].forEach(id => showError(id, ''));
    const submitErr = document.getElementById('submit-error');
    if (submitErr) { submitErr.textContent = ''; submitErr.style.display = 'none'; }
  }

  function validate() {
    let ok = true;

    const name = document.getElementById('respondent-name').value.trim();
    if (!name) { showError('name-error', 'Please enter your name.'); ok = false; }

    const contactType = document.querySelector('input[name="contact_type"]:checked')?.value;
    const contactRaw  = document.getElementById('contact-input').value.trim();

    if (!contactRaw) {
      showError('contact-error', contactType === 'email'
        ? 'Please enter your email address.'
        : 'Please enter your Tumblr handle.');
      ok = false;
    } else if (contactType === 'email') {
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRe.test(contactRaw)) {
        showError('contact-error', 'Please enter a valid email address.');
        ok = false;
      }
    }

    const size    = getSelectedSize();
    const needed  = MIN_PICKS[size];
    const checked = document.querySelectorAll('input[type="checkbox"][data-question-id]:checked');
    if (checked.length < needed) {
      showError('picks-error', `Please select at least ${needed} options for a ${SIZE_LABEL[size]} card.`);
      ok = false;
    }

    return ok;
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit(e) {
    e.preventDefault();
    clearErrors();

    // Honeypot check
    if (document.getElementById('hp-website').value) return;

    if (!validate()) return;

    const submitBtn  = document.getElementById('submit-btn');
    const submitErr  = document.getElementById('submit-error');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    const name        = document.getElementById('respondent-name').value.trim();
    const contactType = document.querySelector('input[name="contact_type"]:checked').value;
    const contactRaw  = document.getElementById('contact-input').value.trim();
    const contactVal  = contactType === 'tumblr' ? normalizeTumblr(contactRaw) : contactRaw;
    const size        = getSelectedSize();

    const supa = window.supabaseClient;

    const submissionId = crypto.randomUUID();

    // Insert submission
    const { error: subErr } = await supa
      .from('submissions')
      .insert({
        id:              submissionId,
        respondent_name: name,
        contact_type:    contactType,
        contact_value:   contactVal,
        card_size:       size,
      });

    if (subErr) {
      submitErr.textContent = 'Something went wrong. Please try again.';
      submitErr.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit & Get My Card';
      return;
    }

    // Build picks rows
    const checked = document.querySelectorAll('input[type="checkbox"][data-question-id]:checked');
    const picks = [];
    checked.forEach(chk => {
      picks.push({
        submission_id: submissionId,
        question_id:   chk.dataset.questionId,
        option_id:     chk.value,
        option_text:   chk.dataset.optionText,
      });
    });

    if (picks.length > 0) {
      const { error: picksErr } = await supa.from('submission_picks').insert(picks);
      if (picksErr) {
        // Submission exists but picks failed — still show thank-you; card may error and need regen
        console.error('Picks insert failed:', picksErr.message);
      }
    }

    // Show thank-you
    document.getElementById('survey-form').style.display = 'none';
    const thankYou = document.getElementById('thank-you');
    thankYou.style.display = 'block';
    thankYou.classList.add('visible');

    // Build picks summary from local checked data (no re-fetch needed)
    const pickData = picks.map(p => ({ question_id: p.question_id, option_text: p.option_text }));
    document.getElementById('picks-summary').innerHTML = buildPicksSummaryHTML(pickData);
  }

  // ── Contact type toggle ───────────────────────────────────────────────────

  function setupContactToggle() {
    const radios    = document.querySelectorAll('input[name="contact_type"]');
    const input     = document.getElementById('contact-input');
    const labelEl   = document.getElementById('contact-label');
    const prefix    = document.getElementById('contact-prefix');

    function applyContactType(type) {
      if (type === 'email') {
        input.type        = 'email';
        input.placeholder = 'you@example.com';
        labelEl.textContent = 'Your email address';
        input.autocomplete  = 'email';
        if (prefix) prefix.style.display = 'none';
      } else {
        input.type        = 'text';
        input.placeholder = 'your-tumblr-handle';
        labelEl.textContent = 'Your Tumblr handle';
        input.autocomplete  = 'off';
        if (prefix) prefix.style.display = '';
      }
    }

    radios.forEach(r => {
      r.addEventListener('change', () => applyContactType(r.value));
    });

    // Apply initial state
    const initial = document.querySelector('input[name="contact_type"]:checked');
    if (initial) applyContactType(initial.value);
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    window.supabaseClient.auth.signOut();
    renderQuestions();
    setupContactToggle();
    setupTooltips();
    updatePicksCounter();

    document.querySelectorAll('input[name="card_size"]').forEach(r => {
      r.addEventListener('change', updatePicksCounter);
    });

    document.getElementById('survey-form').addEventListener('submit', handleSubmit);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
