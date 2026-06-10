/* ===========================================================================
   Isfar — save-as-image: a purpose-built summary card drawn on canvas.
   cardLines() is the PURE layout model (tested); drawCard() rasterizes it with
   the live theme's tokens; exportImage() delivers via Web Share or download.
   Hand-drawn on purpose: DOM capture hits the known backdrop-filter artifact.
   =========================================================================== */
import { METHODS } from './data.js';

const SECTION_LABEL = { before: 'Before departure', inflight: 'In flight', after: 'After arrival' };
const MADHAB_LABEL = { shafi: 'Standard Asr', hanafi: 'Hanafi Asr' };

export function cardLines(f, settings) {
  const dur = `${Math.floor(f.durationMin / 60)}h ${String(f.durationMin % 60).padStart(2, '0')}m`;
  const order = [f.from.iata, f.to.iata];
  const lines = [
    { kind: 'title', text: f.routeMode ? `${f.from.iata} → ${f.to.iata}` : `${f.code} · ${f.from.iata} → ${f.to.iata}` },
    { kind: 'sub', text: `${f.date} · ${dur} · ${f.from.city} ${f.dep.local} → ${f.to.city} ${f.arr.local}` }
  ];
  for (const status of ['before', 'inflight', 'after']) {
    const items = f.prayers.filter((p) => p.status === status);
    if (!items.length) continue;
    lines.push({ kind: 'section', text: SECTION_LABEL[status] });
    for (const p of items) {
      const t = (z) => `${z.iata} ${p.estimated ? '~' : ''}${z.time}`;
      lines.push({
        kind: 'prayer', en: p.en + (p.seq ? ` (${p.seq})` : ''), ar: p.ar, estimated: p.estimated,
        right: order.map((i) => p.zones[i]).filter(Boolean).map(t).join(' · ')
      });
    }
  }
  if (f.prayers.some((p) => p.estimated)) {
    lines.push({ kind: 'note', text: '~ estimated — the sky here gives the usual angles nothing to mark · isfar.app/guide' });
  }
  const m = METHODS.find((x) => x.key === settings.method);
  lines.push({ kind: 'footer', text: `${m ? m.label : settings.method} · ${MADHAB_LABEL[settings.madhab] || ''} — isfar.app` });
  return lines;
}

/* geometry per line kind: [topGap, fontPx, weight] */
const KIND = {
  title:   [0, 56, 600],
  sub:     [16, 29, 500],
  section: [46, 25, 700],
  prayer:  [20, 37, 600],
  note:    [38, 25, 500],
  footer:  [46, 25, 600]
};
const W = 1080, PAD = 84, LH = 1.25;

export function drawCard(f, settings, tokens) {
  const lines = cardLines(f, settings);
  let h = PAD;
  const pos = lines.map((l) => {
    const [gap, size] = KIND[l.kind];
    h += gap; const y = h; h += size * LH;
    return y;
  });
  h += PAD;

  const c = document.createElement('canvas');
  c.width = W; c.height = Math.round(h);
  const x = c.getContext('2d');
  x.fillStyle = tokens.bg; x.fillRect(0, 0, W, c.height);
  x.textBaseline = 'top';
  const grot = (w, s) => `${w} ${s}px "Hanken Grotesk", system-ui, sans-serif`;

  lines.forEach((l, i) => {
    const [, size, weight] = KIND[l.kind];
    const y = pos[i];
    if (l.kind === 'prayer') {
      x.font = grot(weight, size);
      x.fillStyle = tokens.text;
      x.fillText(l.en, PAD, y);
      const enW = x.measureText(l.en).width;
      x.font = `500 ${Math.round(size * 0.72)}px "Noto Kufi Arabic", system-ui, sans-serif`;
      x.fillStyle = tokens.mute;
      x.fillText(l.ar, PAD + enW + 18, y + size * 0.12);
      x.font = grot(600, Math.round(size * 0.92));
      x.fillStyle = l.estimated ? tokens.mute : tokens.text;
      x.textAlign = 'right'; x.fillText(l.right, W - PAD, y + size * 0.06); x.textAlign = 'left';
    } else if (l.kind === 'section') {
      x.font = grot(700, size);
      x.fillStyle = tokens.accent;
      const label = l.text.toUpperCase();
      x.fillText(label, PAD, y);
      x.strokeStyle = tokens.border; x.lineWidth = 2;
      const tw = x.measureText(label).width;
      x.beginPath(); x.moveTo(PAD + tw + 20, y + size * 0.55); x.lineTo(W - PAD, y + size * 0.55); x.stroke();
    } else if (l.kind === 'title') {
      x.font = `600 ${size}px "Newsreader", Georgia, serif`;
      x.fillStyle = tokens.text;
      x.fillText(l.text, PAD, y);
    } else {
      x.font = grot(weight, size);
      x.fillStyle = tokens.mute;
      x.fillText(l.text, PAD, y);
    }
  });
  return c;
}

function themeTokens(el) {
  const s = getComputedStyle(el);
  const v = (n, fb) => (s.getPropertyValue(n) || '').trim() || fb;
  return {
    bg: v('--surface', '#16131f'), text: v('--text', '#ffffff'),
    mute: v('--text-mute', '#9a93a8'), accent: v('--accent', '#e8a34b'),
    border: v('--border', '#3a3450')
  };
}

export async function exportImage(f, settings, rootEl) {
  try {
    await Promise.all([
      document.fonts.load('600 56px "Newsreader"'),
      document.fonts.load('600 37px "Hanken Grotesk"'),
      document.fonts.load('500 27px "Noto Kufi Arabic"')
    ]);
  } catch (e) {}
  const canvas = drawCard(f, settings, themeTokens(rootEl));
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('toBlob failed');
  const name = `isfar-${f.code.replace(/[^A-Za-z0-9]+/g, '-')}.png`;
  const file = typeof File !== 'undefined' ? new File([blob], name, { type: 'image/png' }) : null;
  if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
    try { await navigator.share({ files: [file], title: 'Isfar — ' + f.code }); return 'shared'; }
    catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; /* else fall through to download */ }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}
