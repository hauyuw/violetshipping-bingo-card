import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Resvg, initWasm } from 'npm:@resvg/resvg-wasm@2.6.2';

// ── WASM init ─────────────────────────────────────────────────────────────────
let wasmReady = false;
async function ensureWasm() {
  if (wasmReady) return;
  const wasmRes = await fetch('https://esm.sh/@resvg/resvg-wasm@2.6.2/index_bg.wasm');
  await initWasm(await wasmRes.arrayBuffer());
  wasmReady = true;
}

// ── Card config ───────────────────────────────────────────────────────────────
const CARD_CONFIGS = {
  nano:     { cols: 3, rows: 1, canvasW: 1200, margin: 40, freeIdx: -1 },
  mini:     { cols: 3, rows: 3, canvasW: 1275, margin: 75, freeIdx: 4  },
  standard: { cols: 5, rows: 5, canvasW: 1275, margin: 75, freeIdx: 12 },
};
const MIN_PICKS = { nano: 3, mini: 8, standard: 24 };
const GAP = 6;
const STROKE_W = 3;
const RX = 8;

// SVG palette — kept in sync with styles.css CSS variables
const PALETTE = {
  bg:          '#0d0818',   // --bg
  surface:     '#1a0f2e',   // --surface
  surface2:    '#251540',   // --surface-2
  text:        '#e8d5f5',   // --text
  textMuted:   '#c4b0e0',   // --text-muted (contrast-fixed)
  accent:      '#7c3aed',   // --accent-btn (darker, for filled cells)
  accentLight: '#a78bfa',   // --accent (for decorative strokes)
  accent2:     '#d4b4fe',   // --accent-2
  accentFg:    '#ffffff',   // --accent-contrast
  gold:        '#e2b96a',   // --accent-gold (contrast-fixed)
  border:      '#3d2060',   // --border
  borderLight: '#7a5aaa',   // --border-light (contrast-fixed)
};

// ── Font loading ──────────────────────────────────────────────────────────────
let fontBuffers: Uint8Array[] | null = null;
async function getFontBuffers(): Promise<Uint8Array[]> {
  if (fontBuffers) return fontBuffers;
  const base = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/fonts`;
  const [regular, bold, noto, symbols, cinzel] = await Promise.all([
    fetch(`${base}/Inter-Regular.ttf`).then(r => r.arrayBuffer()).then(b => new Uint8Array(b)),
    fetch(`${base}/Inter-Bold.ttf`).then(r => r.arrayBuffer()).then(b => new Uint8Array(b)),
    fetch(`${base}/NotoSans-Regular.ttf`).then(r => r.arrayBuffer()).then(b => new Uint8Array(b)),
    fetch(`${base}/NotoSansSymbols2-Regular.ttf`).then(r => r.arrayBuffer()).then(b => new Uint8Array(b)),
    fetch(`${base}/Cinzel-Bold.ttf`).then(r => r.arrayBuffer()).then(b => new Uint8Array(b)),
  ]);
  let raleway: Uint8Array | null = null;
  try {
    const r = await fetch(`${base}/Raleway-Regular.ttf`);
    if (r.ok) raleway = new Uint8Array(await r.arrayBuffer());
  } catch { /* Raleway not uploaded; cells fall back to Inter */ }
  fontBuffers = raleway ? [regular, bold, noto, symbols, cinzel, raleway] : [regular, bold, noto, symbols, cinzel];
  return fontBuffers;
}

// ── Seeded Fisher-Yates shuffle ───────────────────────────────────────────────
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const j = Math.abs(s) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Word wrap (font metric approximation) ─────────────────────────────────────
const AVG_CHAR_RATIO = 0.62; // Inter runs wider than 0.52; conservative estimate reduces overflow
const PADDING = 10;

function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  // Treat '/' as a break opportunity: "Posted/updated" → ["Posted/", "updated"]
  const rawWords = text.split(/\s+/);
  const words: string[] = [];
  for (const w of rawWords) {
    const parts = w.split('/');
    parts.forEach((p, i) => {
      if (p) words.push(i < parts.length - 1 ? p + '/' : p);
    });
  }

  const charW = fontSize * AVG_CHAR_RATIO;
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length * charW <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function fitsInCell(lines: string[], fontSize: number, cellW: number, cellH: number): boolean {
  const charW      = fontSize * AVG_CHAR_RATIO;
  const lineHeight = fontSize * 1.3;
  const maxW       = cellW - PADDING * 2;
  if (lines.length * lineHeight > cellH - PADDING * 2) return false;
  return lines.every(l => l.length * charW <= maxW);
}

// Returns the largest fontSize where N words stack vertically and each fits in width
function freeCellFontSize(words: string[], cellSize: number): number {
  const n      = words.length;
  const maxH   = cellSize - PADDING * 2;
  const maxW   = cellSize - PADDING * 2;
  let fontSize = Math.floor(cellSize * 0.17);
  const minSize = 16;
  while (fontSize >= minSize) {
    const lineHeight = fontSize * 1.3;
    if (n * lineHeight > maxH) { fontSize -= 2; continue; }
    if (words.every(w => w.length * fontSize * AVG_CHAR_RATIO <= maxW)) return fontSize;
    fontSize -= 2;
  }
  return minSize;
}

// Returns the largest fontSize at which every text in the list fits in a square cell
function uniformFontSize(allTexts: string[], cellSize: number): number {
  let fontSize = Math.floor(cellSize * 0.17);
  const minSize = 16;
  const maxW    = cellSize - PADDING * 2;

  while (fontSize >= minSize) {
    const allFit = allTexts.every(text => {
      const lines = wrapText(text, fontSize, maxW);
      return fitsInCell(lines, fontSize, cellSize, cellSize);
    });
    if (allFit) return fontSize;
    fontSize -= 2;
  }
  return minSize;
}

function renderLines(text: string, fontSize: number, cellSize: number): string[] {
  const maxW = cellSize - PADDING * 2;
  let lines  = wrapText(text, fontSize, maxW);

  // Last-resort truncation if still overflowing at minSize
  while (!fitsInCell(lines, fontSize, cellSize, cellSize) && lines.length > 1) {
    lines.pop();
  }
  if (!fitsInCell(lines, fontSize, cellSize, cellSize)) {
    const charsPerLine = Math.floor(maxW / (fontSize * AVG_CHAR_RATIO));
    lines = [text.slice(0, charsPerLine - 1) + '…'];
  }
  return lines;
}

// ── SVG cell ──────────────────────────────────────────────────────────────────
function cellSvg(
  x: number, y: number, size: number,
  text: string, fontSize: number, isFree = false,
): string {
  const fill      = isFree ? PALETTE.accent      : PALETTE.surface;
  const stroke    = isFree ? PALETTE.gold        : PALETTE.border;
  const strokeW   = isFree ? STROKE_W + 1        : STROKE_W;
  const fgColor   = isFree ? PALETTE.accentFg    : PALETTE.text;

  const lines       = isFree
    ? text.split(/\s+/).filter(Boolean)
    : renderLines(text, fontSize, size);
  const lineHeight  = fontSize * 1.3;
  const totalHeight = lines.length * lineHeight;
  const startY      = y + (size - totalHeight) / 2 + fontSize * 0.85;

  // FREE cell: Cinzel Bold (display font). Body cells: Inter + NotoSans fallback.
  const fontFamily = isFree ? 'Cinzel, NotoSans' : 'Raleway, Inter, NotoSans';
  const fontWeight = isFree ? 'bold' : 'normal';

  const cx = x + size / 2;
  let tspans = '';
  lines.forEach((line, i) => {
    const ty = startY + i * lineHeight;
    if (isFree && line.includes('✦')) {
      // Split ✦ into its own tspan so Cinzel handles text and Noto handles the symbol.
      // dy="0" on subsequent tspans avoids starting a new text chunk, preserving centering.
      const parts = line.split(/(✦)/);
      let isFirst = true;
      for (const part of parts) {
        if (!part) continue;
        const pFont = part === '✦' ? '"Noto Sans Symbols 2"' : fontFamily;
        if (isFirst) {
          tspans += `<tspan x="${cx}" y="${ty}" font-family="${pFont}">${escSvg(part)}</tspan>`;
          isFirst = false;
        } else {
          tspans += `<tspan dy="0" font-family="${pFont}">${escSvg(part)}</tspan>`;
        }
      }
    } else {
      tspans += `<tspan x="${cx}" y="${ty}">${escSvg(line)}</tspan>`;
    }
  });

  return `
  <rect x="${x + strokeW / 2}" y="${y + strokeW / 2}"
        width="${size - strokeW}" height="${size - strokeW}"
        rx="${RX}" ry="${RX}"
        fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}"/>
  <text font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}"
        fill="${fgColor}" text-anchor="middle">${tspans}</text>`;
}

function escSvg(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Build SVG ─────────────────────────────────────────────────────────────────
function buildSvg(cells: string[], cfg: typeof CARD_CONFIGS.mini): string {
  const { cols, rows, canvasW, margin, freeIdx } = cfg;

  const titleFontSize = Math.floor(Math.min(72, Math.max(48, canvasW * 0.055)));

  // Vertical layout: "Violetshipping" → "Commenting Bingo" → gem divider → grid
  const titleY1    = margin + titleFontSize;
  const titleY2    = titleY1 + Math.round(titleFontSize * 1.18);
  const dividerY   = Math.round(titleY2 + titleFontSize * 0.45);
  const gridStartY = dividerY + 24;

  // Square cells: size driven by available width
  const cellSize = Math.floor((canvasW - margin * 2 - GAP * (cols - 1)) / cols);
  const gridW    = cols * cellSize + GAP * (cols - 1);
  const gridH    = rows * cellSize + GAP * (rows - 1);
  const canvasH  = gridStartY + gridH + margin;

  const gridStartX = Math.floor((canvasW - gridW) / 2);

  const freeText = Deno.env.get('FREE_CELL_TEXT') || 'FREE';

  // Body cells and FREE cell sized independently so long body texts don't shrink the FREE cell
  const bodyTexts: string[] = [];
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r * cols + c !== freeIdx) bodyTexts.push(cells[idx++] ?? '');
    }
  }
  const bodyFontSize = uniformFontSize(bodyTexts, cellSize);
  const freeWords    = freeText.split(/\s+/).filter(Boolean);
  const freeFontSize = freeIdx >= 0 ? freeCellFontSize(freeWords, cellSize) : bodyFontSize;

  let rects = '';
  idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const pos      = r * cols + c;
      const x        = gridStartX + c * (cellSize + GAP);
      const y        = gridStartY + r * (cellSize + GAP);
      const isFree   = pos === freeIdx;
      const text     = isFree ? freeText : (cells[idx++] ?? '');
      const fontSize = isFree ? freeFontSize : bodyFontSize;
      rects += cellSvg(x, y, cellSize, text, fontSize, isFree);
    }
  }

  // Decorative gem + rule under the title (mirrors the site's hero-divider)
  const gemSize = 5;
  const gemCx   = canvasW / 2;
  const ruleLen = Math.floor(canvasW * 0.18);
  const ruleGap = 14;

  const titleDecor = `
  <line x1="${gemCx - ruleGap - ruleLen}" y1="${dividerY}" x2="${gemCx - ruleGap}" y2="${dividerY}"
        stroke="${PALETTE.borderLight}" stroke-width="1" opacity="0.7"/>
  <rect x="${gemCx - gemSize / 2}" y="${dividerY - gemSize / 2}"
        width="${gemSize}" height="${gemSize}"
        fill="${PALETTE.accentLight}" transform="rotate(45 ${gemCx} ${dividerY})"/>
  <line x1="${gemCx + ruleGap}" y1="${dividerY}" x2="${gemCx + ruleGap + ruleLen}" y2="${dividerY}"
        stroke="${PALETTE.borderLight}" stroke-width="1" opacity="0.7"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}">
  <defs>
    <linearGradient id="title-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${PALETTE.accent2}"/>
      <stop offset="100%" stop-color="${PALETTE.gold}"/>
    </linearGradient>
  </defs>
  <rect width="${canvasW}" height="${canvasH}" fill="${PALETTE.bg}"/>
  ${rects}
  <text x="${canvasW / 2}" y="${titleY1}"
        font-family="Cinzel, NotoSans" font-size="${titleFontSize}" font-weight="bold"
        fill="${PALETTE.text}" text-anchor="middle" letter-spacing="2">Violetshipping</text>
  <text x="${canvasW / 2}" y="${titleY2}"
        font-family="Cinzel, NotoSans" font-size="${titleFontSize}" font-weight="bold"
        fill="url(#title-grad)" text-anchor="middle" letter-spacing="2">Commenting Bingo</text>
  ${titleDecor}
</svg>`;
}

// ── Main handler ──────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const svcClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: 'Invalid JSON' }, 400);
  }

  // Support both webhook body { record: { id } } and direct invoke { submission_id }
  const submissionId: string | undefined =
    (body?.record as { id?: string })?.id ?? (body?.submission_id as string | undefined);

  if (!submissionId) return jsonResp({ error: 'Missing submission_id' }, 400);

  // Mark generating + increment attempt
  await svcClient
    .from('submissions')
    .update({ card_status: 'generating' })
    .eq('id', submissionId)
    .select('gen_attempts')
    .single()
    .then(async ({ data }) => {
      await svcClient
        .from('submissions')
        .update({ gen_attempts: ((data?.gen_attempts as number) ?? 0) + 1 })
        .eq('id', submissionId);
    });

  // Fetch submission
  const { data: sub, error: subErr } = await svcClient
    .from('submissions')
    .select('*')
    .eq('id', submissionId)
    .single();

  if (subErr || !sub) {
    return jsonResp({ error: 'Submission not found' }, 404);
  }

  const cardSize: string = sub.card_size;
  const cfg = CARD_CONFIGS[cardSize as keyof typeof CARD_CONFIGS];
  if (!cfg) return jsonResp({ error: `Unknown card_size: ${cardSize}` }, 400);

  const minPicks = MIN_PICKS[cardSize as keyof typeof MIN_PICKS];
  const totalCells = cfg.cols * cfg.rows - (cfg.freeIdx >= 0 ? 1 : 0);

  // Retry loop
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      // Poll for picks (race condition: webhook fires before picks are inserted)
      let allPicks: { option_id: string; question_id: string; option_text: string }[] = [];
      for (let poll = 0; poll < 5; poll++) {
        const { data } = await svcClient
          .from('submission_picks')
          .select('*')
          .eq('submission_id', submissionId);
        if (data && data.length >= minPicks) { allPicks = data; break; }
        await sleep(1000);
      }

      // Dedupe by option_id (keep first occurrence)
      const seen = new Set<string>();
      const picks = allPicks.filter(p => {
        if (seen.has(p.option_id)) return false;
        seen.add(p.option_id);
        return true;
      });

      if (picks.length < minPicks) {
        throw new Error(`Not enough picks: got ${picks.length}, need ${minPicks}`);
      }

      // Seeded shuffle using first 8 hex chars of submission UUID
      const seedHex = submissionId.replace(/-/g, '').slice(0, 8);
      const seed    = parseInt(seedHex, 16);
      const shuffled = seededShuffle(picks, seed);
      const cells    = shuffled.slice(0, totalCells).map(p => p.option_text);

      // Build SVG → PNG
      await ensureWasm();
      const fonts = await getFontBuffers();
      const svg   = buildSvg(cells, cfg);

      const resvg = new Resvg(svg, {
        font: { loadSystemFonts: false, fontBuffers: fonts },
      });
      const pngData = resvg.render();
      const pngBuf  = pngData.asPng();

      // Upload to Storage
      const storagePath = `${submissionId}.png`;
      const { error: uploadErr } = await svcClient.storage
        .from('cards')
        .upload(storagePath, pngBuf, {
          contentType: 'image/png',
          upsert: true,
        });

      if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

      // Mark ready
      await svcClient
        .from('submissions')
        .update({
          card_status:       'ready',
          card_storage_path: storagePath,
          error_message:     null,
        })
        .eq('id', submissionId);

      // Auto-send: fetch stored Tumblr token and call send-card
      const { data: tokenRow } = await svcClient
        .from('settings')
        .select('value')
        .eq('key', 'tumblr_token')
        .maybeSingle();

      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

      await fetch(`${supabaseUrl}/functions/v1/send-card`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          submission_id: submissionId,
          ...(tokenRow?.value ? { tumblr_token: tokenRow.value } : {}),
        }),
      });

      return jsonResp({ ok: true });
    } catch (err) {
      console.error(`generate-card attempt ${attempt + 1} failed:`, err);
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(2000);
      } else {
        await svcClient
          .from('submissions')
          .update({
            card_status:   'error',
            error_message: (err as Error).message,
          })
          .eq('id', submissionId);

        return jsonResp({ ok: false, error: (err as Error).message }, 500);
      }
    }
  }

  return jsonResp({ ok: false, error: 'Unknown error' }, 500);
});

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
