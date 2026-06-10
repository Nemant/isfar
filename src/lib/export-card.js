/* ===========================================================================
   Isfar — save-as-image: a purpose-built summary card drawn on canvas.
   cardLines() is the PURE layout model (tested); drawCard() rasterizes it with
   the live theme's tokens; exportImage() delivers via Web Share or download.
   Hand-drawn on purpose: DOM capture hits the known backdrop-filter artifact.
   The card doubles as the app's shareable face — it opens with the brand and
   the horizon-and-low-sun motif and closes with isfar.app + tagline, so a
   shared image carries the app with it.
   =========================================================================== */
import { METHODS } from './data.js';

const SECTION_LABEL = { before: 'Before departure', inflight: 'In flight', after: 'After arrival' };
const MADHAB_LABEL = { shafi: 'Standard Asr', hanafi: 'Hanafi Asr' };
const TAGLINE = 'Prayer times across your flight';

export function cardLines(f, settings) {
  const dur = `${Math.floor(f.durationMin / 60)}h ${String(f.durationMin % 60).padStart(2, '0')}m`;
  const order = [f.from.iata, f.to.iata];
  const lines = [
    { kind: 'brand', text: 'Isfar', ar: 'إسفار' },
    { kind: 'title', text: f.routeMode ? `${f.from.iata} → ${f.to.iata}` : `${f.code} · ${f.from.iata} → ${f.to.iata}` },
    { kind: 'sub', text: `${f.date} · ${dur} · ${f.from.city} ${f.dep.local} → ${f.to.city} ${f.arr.local}` },
    { kind: 'horizon' }
  ];
  for (const status of ['before', 'inflight', 'after']) {
    const items = f.prayers.filter((p) => p.status === status);
    if (!items.length) continue;
    lines.push({ kind: 'section', text: SECTION_LABEL[status] });
    for (const p of items) {
      const t = (z) => `${z.iata} ${p.estimated ? '~' : ''}${z.time}`;
      lines.push({
        kind: 'prayer', en: p.en, ar: p.ar, estimated: p.estimated,
        right: order.map((i) => p.zones[i]).filter(Boolean).map(t).join(' · ')
      });
    }
  }
  if (f.prayers.some((p) => p.estimated)) {
    lines.push({ kind: 'note', text: '~ estimated — the sky here gives the usual angles nothing to mark · isfar.app/guide' });
  }
  const m = METHODS.find((x) => x.key === settings.method);
  lines.push({ kind: 'footer', text: `${m ? m.label : settings.method} · ${MADHAB_LABEL[settings.madhab] || ''}` });
  lines.push({ kind: 'url', text: 'isfar.app', tagline: TAGLINE });
  return lines;
}

/* geometry per line kind: [topGap, fontPx, weight] (horizon's fontPx is just
   its reserved height — it draws a line + sun, not text) */
const KIND = {
  brand:   [0, 42, 600],
  title:   [44, 58, 600],
  sub:     [16, 28, 500],
  horizon: [40, 10, 0],
  section: [42, 25, 700],
  prayer:  [20, 37, 600],
  note:    [38, 24, 500],
  footer:  [52, 23, 500],
  url:     [18, 32, 700]
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

  // the app's sky: top→bottom gradient instead of a flat panel
  const sky = x.createLinearGradient(0, 0, 0, c.height);
  sky.addColorStop(0, tokens.bgTop);
  sky.addColorStop(1, tokens.bgBottom);
  x.fillStyle = sky; x.fillRect(0, 0, W, c.height);

  x.textBaseline = 'top';
  const grot = (w, s) => `${w} ${s}px "Hanken Grotesk", system-ui, sans-serif`;
  const kufi = (s) => `500 ${s}px "Noto Kufi Arabic", system-ui, sans-serif`;
  const sun = (cx, cy, r) => {
    x.save();
    x.shadowColor = tokens.maghrib; x.shadowBlur = r * 4;
    x.fillStyle = tokens.maghrib;
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
    x.fill(); // second pass deepens the glow
    x.restore();
  };

  lines.forEach((l, i) => {
    const [, size, weight] = KIND[l.kind];
    const y = pos[i];
    if (l.kind === 'brand') {
      x.font = `600 ${size}px "Newsreader", Georgia, serif`;
      x.fillStyle = tokens.text;
      x.fillText(l.text, PAD, y);
      const bw = x.measureText(l.text).width;
      x.font = kufi(Math.round(size * 0.62));
      x.fillStyle = tokens.mute;
      x.fillText(l.ar, PAD + bw + 20, y + size * 0.28);
    } else if (l.kind === 'title') {
      x.font = `600 ${size}px "Newsreader", Georgia, serif`;
      x.fillStyle = tokens.text;
      x.fillText(l.text, PAD, y);
    } else if (l.kind === 'horizon') {
      // the landing divider: a hairline with the low sun glowing at its centre
      const ly = y + size / 2;
      x.strokeStyle = tokens.border; x.lineWidth = 2;
      x.beginPath(); x.moveTo(PAD, ly); x.lineTo(W - PAD, ly); x.stroke();
      sun(W / 2, ly, 9);
    } else if (l.kind === 'section') {
      x.font = grot(700, size);
      x.fillStyle = tokens.accent;
      const label = l.text.toUpperCase();
      x.fillText(label, PAD, y);
      x.strokeStyle = tokens.border; x.lineWidth = 2;
      const tw = x.measureText(label).width;
      x.beginPath(); x.moveTo(PAD + tw + 20, y + size * 0.55); x.lineTo(W - PAD, y + size * 0.55); x.stroke();
    } else if (l.kind === 'prayer') {
      x.font = grot(weight, size);
      x.fillStyle = tokens.text;
      x.fillText(l.en, PAD, y);
      const enW = x.measureText(l.en).width;
      x.font = kufi(Math.round(size * 0.72));
      x.fillStyle = tokens.mute;
      x.fillText(l.ar, PAD + enW + 18, y + size * 0.12);
      x.font = grot(600, Math.round(size * 0.92));
      x.fillStyle = l.estimated ? tokens.mute : tokens.text;
      x.textAlign = 'right'; x.fillText(l.right, W - PAD, y + size * 0.06); x.textAlign = 'left';
    } else if (l.kind === 'url') {
      sun(PAD + 9, y + size * 0.52, 8);
      x.font = grot(weight, size);
      x.fillStyle = tokens.accent;
      x.fillText(l.text, PAD + 34, y);
      const uw = x.measureText(l.text).width;
      x.font = grot(500, Math.round(size * 0.74));
      x.fillStyle = tokens.mute;
      x.fillText('— ' + l.tagline, PAD + 34 + uw + 16, y + size * 0.18);
    } else { // sub · note · footer
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
    bgTop: v('--bg-top', '#1c1830'), bgBottom: v('--bg-bottom', '#100d1c'),
    text: v('--text', '#ffffff'), mute: v('--text-mute', '#9a93a8'),
    accent: v('--accent', '#e8a34b'), border: v('--border', '#3a3450'),
    maghrib: v('--sky-maghrib', '#e8854b')
  };
}

export async function exportImage(f, settings, rootEl) {
  try {
    await Promise.all([
      document.fonts.load('600 58px "Newsreader"'),
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
