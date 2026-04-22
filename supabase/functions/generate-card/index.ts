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

// SVG palette
const PALETTE = {
  bg:       '#120a1f',
  surface:  '#1e1033',
  text:     '#e8d5f5',
  accent:   '#8b5cf6',
  accentFg: '#ffffff',
  border:   '#3d2060',
};

// ── Font loading ──────────────────────────────────────────────────────────────
let fontBuffers: Uint8Array[] | null = null;
async function getFontBuffers(): Promise<Uint8Array[]> {
  if (fontBuffers) return fontBuffers;
  const base = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/fonts`;
  const [regular, bold, noto, symbols] = await Promise.all([
    fetch(`${base}/Inter-Regular.ttf`).then(r => r.arrayBuffer()).then(b => new Uint8Array(b)),
    fetch(`${base}/Inter-Bold.ttf`).then(r => r.arrayBuffer()).then(b => new Uint8Array(b)),
    fetch(`${base}/NotoSans-Regular.ttf`).then(r => r.arrayBuffer()).then(b => new Uint8Array(b)),
    fetch(`${base}/NotoSansSymbols2-Regular.ttf`).then(r => r.arrayBuffer()).then(b => new Uint8Array(b)),
  ]);
  fontBuffers = [regular, bold, noto, symbols];
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

function fitText(text: string, cellW: number, cellH: number): { lines: string[]; fontSize: number } {
  let fontSize = Math.floor(cellH * 0.22);
  const minSize = 16;
  const maxW    = cellW - PADDING * 2;

  while (fontSize >= minSize) {
    const lines = wrapText(text, fontSize, maxW);
    if (fitsInCell(lines, fontSize, cellW, cellH)) return { lines, fontSize };
    fontSize -= 2;
  }

  // At floor — truncate if needed
  let lines = wrapText(text, minSize, maxW);
  while (!fitsInCell(lines, minSize, cellW, cellH) && lines.length > 1) {
    lines.pop();
  }
  if (!fitsInCell(lines, minSize, cellW, cellH)) {
    const charsPerLine = Math.floor(maxW / (minSize * AVG_CHAR_RATIO));
    lines = [text.slice(0, charsPerLine - 1) + '…'];
  }
  return { lines, fontSize: minSize };
}

// ── SVG cell ──────────────────────────────────────────────────────────────────
function cellSvg(
  x: number, y: number, w: number, h: number,
  text: string, isFree = false,
): string {
  const fill   = isFree ? PALETTE.accent   : PALETTE.surface;
  const stroke = isFree ? PALETTE.accent   : PALETTE.border;
  const fgColor = isFree ? PALETTE.accentFg : PALETTE.text;

  const { lines, fontSize } = fitText(text, w, h);

  const lineHeight  = fontSize * 1.3;
  const totalHeight = lines.length * lineHeight;
  const startY      = y + (h - totalHeight) / 2 + fontSize * 0.85;

  const fontWeight = isFree ? 'bold' : 'normal';
  const fontFamily = isFree ? 'Inter Bold, NotoSans' : 'Inter, NotoSans';

  let tspans = '';
  lines.forEach((line, i) => {
    const ty = startY + i * lineHeight;
    tspans += `<tspan x="${x + w / 2}" y="${ty}">${escSvg(line)}</tspan>`;
  });

  return `
  <rect x="${x + STROKE_W / 2}" y="${y + STROKE_W / 2}"
        width="${w - STROKE_W}" height="${h - STROKE_W}"
        rx="${RX}" ry="${RX}"
        fill="${fill}" stroke="${stroke}" stroke-width="${STROKE_W}"/>
  <text font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}"
        fill="${fgColor}" text-anchor="middle">${tspans}</text>`;
}

function escSvg(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Build SVG ─────────────────────────────────────────────────────────────────
function buildSvg(cells: string[], cfg: typeof CARD_CONFIGS.mini): string {
  const { cols, rows, canvasW, margin, freeIdx } = cfg;

  // Square cells: size driven by available width
  const cellSize = Math.floor((canvasW - margin * 2 - GAP * (cols - 1)) / cols);
  const gridW    = cols * cellSize + GAP * (cols - 1);
  const gridH    = rows * cellSize + GAP * (rows - 1);

  // Canvas height fits the grid exactly with equal top/bottom margins
  const canvasH  = margin + gridH + margin;

  // Center grid horizontally (accounts for rounding)
  const gridStartX = Math.floor((canvasW - gridW) / 2);
  const gridStartY = margin;

  const freeText = Deno.env.get('FREE_CELL_TEXT') || 'FREE';

  let rects = '';
  let idx   = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const pos    = r * cols + c;
      const x      = gridStartX + c * (cellSize + GAP);
      const y      = gridStartY + r * (cellSize + GAP);
      const isFree = pos === freeIdx;
      const text   = isFree ? freeText : (cells[idx++] ?? '');
      rects += cellSvg(x, y, cellSize, cellSize, text, isFree);
    }
  }

  const titleFontSize = Math.floor(margin * 0.55);
  const titleY        = Math.floor(margin * 0.68);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}">
  <rect width="${canvasW}" height="${canvasH}" fill="${PALETTE.bg}"/>
  <text x="${canvasW / 2}" y="${titleY}"
        font-family="Inter Bold, NotoSans" font-size="${titleFontSize}" font-weight="bold"
        fill="${PALETTE.text}" text-anchor="middle">Violetshipping Commenting Bingo</text>
  ${rects}
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
