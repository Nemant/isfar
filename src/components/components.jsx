/* ===========================================================================
   Isfar — icons + presentational components
   =========================================================================== */
import React from 'react';
import { METHODS, GUIDANCE, COLOR } from '../lib/data.js';

/* ---- Icons (stroke, currentColor) --------------------------------------- */
const Ic = {
  sun: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>),
  moon: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>),
  auto: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/></svg>),
  back: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M15 18l-6-6 6-6"/></svg>),
  arrow: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M5 12h14M13 6l6 6-6 6"/></svg>),
  plane: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>),
  globe: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/></svg>),
  book: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 5a2 2 0 0 1 2-2h11v16H6a2 2 0 0 0-2 2zM17 3l3 0v18l-3 0"/></svg>),
  info: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>),
  chev: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M6 9l6 6 6-6"/></svg>),
  gear: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>),
  close: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M18 6 6 18M6 6l12 12"/></svg>),
  alert: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>),
  download: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>),
  share: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>),
  sunrise: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 2v4M4.9 8.9 6.3 10.3M2 16h2M20 16h2M17.7 10.3l1.4-1.4M22 20H2M16 16a4 4 0 0 0-8 0M8 6l4-4 4 4"/></svg>),
  // small filled prayer glyphs per time-of-day
  dawn: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M17 18a5 5 0 0 0-10 0M12 2v3M22 18H2M5 11l1.5 1.5M19 11l-1.5 1.5M12 9a3 3 0 0 0-3 3"/></svg>),
  noon: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" {...p}><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M5 5l1.7 1.7M17.3 17.3 19 19M5 19l1.7-1.7M17.3 6.7 19 5"/></svg>),
  dusk: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M17 18a5 5 0 0 0-10 0M12 9V6M22 18H2M5 11l1.5 1.5M19 11l-1.5 1.5M9 3l3 3 3-3"/></svg>),
  night: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>),
  camera: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 8a2 2 0 0 1 2-2h2l1.2-1.6A1 1 0 0 1 11 4h2a1 1 0 0 1 .8.4L15 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.2"/></svg>),
};
const PRAYER_GLYPH = { fajr: Ic.dawn, dhuhr: Ic.noon, asr: Ic.sun, maghrib: Ic.dusk, isha: Ic.night };

/* ---- Header ------------------------------------------------------------- */
function Header({ theme, onCycleTheme, onHome, onOpenSettings, onOpenGuide, onOpenMethod }) {
  // `theme` here is the *resolved* visible theme (light|dark), so the toggle is a
  // plain two-state flip — every tap visibly changes the sky.
  const next = theme === "dark" ? "light" : "dark";
  const TIc = theme === "dark" ? Ic.moon : Ic.sun;
  const label = theme === "dark" ? "Dark theme" : "Light theme";
  return (
    <header className="hdr">
      <div className="brand" onClick={onHome} role="link" tabIndex={0}
           onKeyDown={(e)=>{ if(e.key==="Enter") onHome(); }} aria-label="Isfar — home">
        <span className="mark">Isfar</span>
        <span className="mark-ar ar" aria-hidden="true">إسفار</span>
      </div>
      <div className="hdr-actions">
        <button className="iconbtn" onClick={onOpenMethod} aria-label="How Isfar works" title="How it works">
          <Ic.info aria-hidden="true" />
        </button>
        <button className="iconbtn" onClick={onOpenGuide} aria-label="Traveller’s guide — qasr &amp; jam'" title="Traveller’s guide">
          <Ic.book aria-hidden="true" />
        </button>
        <button className="iconbtn" onClick={onCycleTheme} aria-label={`${label}. Tap to switch to ${next}.`} title={label}>
          <TIc aria-hidden="true" />
        </button>
        <button className="iconbtn" onClick={onOpenSettings} aria-label="Settings" title="Settings">
          <Ic.gear aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

/* ---- Settings sheet ----------------------------------------------------- */
function SettingsSheet({ open, onClose, method, madhab, onChange }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-sheet" role="dialog" aria-modal="true" aria-label="Settings"
           onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h2>Settings</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close settings"><Ic.close aria-hidden="true" /></button>
        </div>
        <div className="settings-body">
          <div className="set-field">
            <label htmlFor="set-method">Calculation method</label>
            <p className="set-desc">Sets the twilight angles for Fajr and Isha. Pick the authority common where you live.</p>
            <select id="set-method" className="set-select" value={method}
                    onChange={(e) => onChange("method", e.target.value)}>
              {METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>
          <div className="set-field">
            <label>Asr time (madhhab)</label>
            <p className="set-desc">Hanafi takes a later Asr; Standard (Shāfiʽi, Mālikī, Ḥanbalī) is earlier.</p>
            <div className="set-seg" role="group" aria-label="Asr method">
              {[{ v: "shafi", l: "Standard" }, { v: "hanafi", l: "Hanafi" }].map((o) => (
                <button key={o.v} type="button" className={"set-opt" + (madhab === o.v ? " active" : "")}
                        aria-pressed={madhab === o.v} onClick={() => onChange("madhab", o.v)}>{o.l}</button>
              ))}
            </div>
          </div>
          <p className="set-foot">Saved on this device. Times update across every flight.</p>
        </div>
      </div>
    </div>
  );
}

/* ---- Traveller guide sheet --------------------------------------------- */
function GuideSheet({ open, onClose }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const G = GUIDANCE;
  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-sheet" role="dialog" aria-modal="true" aria-label="Traveller's guide"
           onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h2>Travelling lightly</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close"><Ic.close aria-hidden="true" /></button>
        </div>
        <div className="settings-body">
          <p className="guide-intro">Qasr &amp; jam‘ — the concessions a traveller is given.</p>
          {G.map((g) => (
            <div className="guide-rule" key={g.key}>
              <h3>{g.title} <span className="ar" aria-hidden="true">{g.ar}</span>
                <span className="guide-label">· {g.label}</span></h3>
              <p>{g.body}</p>
            </div>
          ))}
          <div className="guide-note">
            <Ic.info aria-hidden="true" />
            <span>Rulings vary between schools of fiqh and circumstances. This is general guidance — follow your own madhhab or a trusted scholar where you have doubt.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- "How it works" sheet ---------------------------------------------- */
function MethodSheet({ open, onClose }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const points = [
    { ic: Ic.globe, t: "We follow the real flight path",
      d: "A plane flies a gently curved route between cities — the shortest way across a round Earth — not a straight line on a flat map. Since prayer times depend on exactly where you are, we follow that true path." },
    { ic: Ic.sun, t: "Calculated where you actually are",
      d: "Rather than only using your take-off or landing city, we work out where the plane is at each moment and find each prayer there. Flying east or west shifts the sun’s timing — and we move along with it." },
    { ic: Ic.sunrise, t: "Adjusted for your altitude",
      d: "From cruising height you can see a little farther over the horizon, so the sun sets slightly later and rises slightly earlier than on the ground. We correct Maghrib and sunrise so they match the view from your window." },
    { ic: Ic.plane, t: "Qibla, relative to the plane",
      d: "A compass is hard to read mid-flight, so we show the direction of the Ka‘bah as a position around a little aircraft — turn that way to face the qibla." },
    { ic: Ic.book, t: "Trusted prayer-time methods",
      d: "The times follow the established calculation authorities — ISNA, Muslim World League, Umm al-Qura and more — not formulas of our own. Choose the one you follow in Settings." },
    { ic: Ic.sunrise, t: "Far-north flights",
      d: "Your method's own dawn and dusk angles are used wherever the sky actually reaches them — at any latitude. In high summer, above roughly 48–55°, the sky may never get dark enough: as long as the sun still rises and sets, we divide your own night into sevenths instead — an established convention that always keeps Isha after the sunset you can see and Fajr before the sunrise — and mark the time with a ~. Only where the cycle itself vanishes (midnight sun, polar night) are the night's times borrowed from latitude 60 at your longitude — about where Stockholm, St Petersburg, Helsinki and Anchorage live — and marked the same way.",
      link: { href: "/guide/far-north-prayer-times/", label: "Read the full story" } },
    { ic: Ic.auto, t: "Yours, on your device",
      d: "Look up a flight while you still have signal, and it’s saved to your device — so it stays available offline once you’re in the air. No account needed; the live flight search itself does need a connection." }
  ];
  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-sheet" role="dialog" aria-modal="true" aria-label="How Isfar works"
           onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h2>How Isfar works</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close"><Ic.close aria-hidden="true" /></button>
        </div>
        <div className="settings-body">
          <p className="guide-intro">A few careful calculations, so you can simply pray.</p>
          <ul className="method-list">
            {points.map((p, i) => (
              <li key={i}>
                <span className="m-ic"><p.ic aria-hidden="true" /></span>
                <div><b>{p.t}</b><span>{p.d}{p.link && (
                  <> <a className="m-link" href={p.link.href}>{p.link.label} →</a></>
                )}</span></div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ---- PWA install nudge (post-results, shown once) ----------------------- */
function InstallNudge({ onInstall, onDismiss }) {
  return (
    <div className="install-nudge" role="note">
      <Ic.plane aria-hidden="true" />
      <span>Save Isfar to your home screen — saved flights work offline.</span>
      <button type="button" className="nudge-act" onClick={onInstall}>Add</button>
      <button type="button" className="iconbtn nudge-x" onClick={onDismiss} aria-label="Dismiss"><Ic.close aria-hidden="true" /></button>
    </div>
  );
}

function IOSInstallSheet({ open, onClose }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-sheet" role="dialog" aria-modal="true" aria-label="Add to Home Screen"
           onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h2>Add to Home Screen</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close"><Ic.close aria-hidden="true" /></button>
        </div>
        <div className="settings-body">
          <ol className="ios-steps">
            <li>Tap the <b>Share</b> button in Safari’s toolbar.</li>
            <li>Scroll and choose <b>Add to Home Screen</b>.</li>
            <li>Tap <b>Add</b> — Isfar opens like an app, and saved flights work offline.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

/* "this one, not that one" pictograph for the scan overlay — a wide barcode
   (PDF417) ticked vs a square QR crossed, so it reads without words. */
function ScanGuideArt() {
  const bars = [4, 9, 14, 17, 23, 26, 31, 37, 40, 46, 51, 54, 60, 65, 68, 74, 79, 84, 88, 94];
  return (
    <svg className="scan-art" viewBox="0 0 230 92" fill="none" aria-hidden="true">
      {/* DO: wide barcode */}
      <rect x="6" y="20" width="124" height="56" rx="9" stroke="currentColor" strokeWidth="2.5" />
      <g fill="currentColor">
        {bars.map((x, i) => (
          <rect key={i} x={18 + x} y="31" width={i % 3 === 0 ? 5 : 2.5} height="34" rx="1" />
        ))}
      </g>
      <circle cx="124" cy="22" r="13" fill="#16a34a" />
      <path d="M117 22.5l4.5 4.5 8-9" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      {/* DON'T: square QR, dimmed + crossed */}
      <g opacity="0.42">
        <rect x="166" y="28" width="48" height="48" rx="7" stroke="currentColor" strokeWidth="2.5" />
        <rect x="172" y="34" width="11" height="11" stroke="currentColor" strokeWidth="2" />
        <rect x="197" y="34" width="11" height="11" stroke="currentColor" strokeWidth="2" />
        <rect x="172" y="59" width="11" height="11" stroke="currentColor" strokeWidth="2" />
        <g fill="currentColor">
          <rect x="198" y="59" width="4" height="4" /><rect x="204" y="63" width="4" height="4" />
          <rect x="198" y="67" width="4" height="4" /><rect x="204" y="55" width="4" height="4" />
        </g>
      </g>
      <circle cx="166" cy="28" r="12" fill="#dc2626" />
      <path d="M161 23l10 10M171 23l-10 10" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

/* ---- Boarding-pass scan overlay ---------------------------------------- */
function ScanSheet({ open, onClose, onResult, parse }) {
  const videoRef = React.useRef(null);
  const [err, setErr] = React.useState(null);
  const [attempt, setAttempt] = React.useState(0); // bump → retry
  React.useEffect(() => {
    if (!open) return;
    setErr(null);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort('timeout'), 15000);
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    let done = false;
    (async () => {
      try {
        const { scanBarcode } = await import('../lib/scan.js');
        const raw = await scanBarcode(videoRef.current, ctrl.signal);
        const pass = parse(raw);
        if (!pass) throw new Error('parse');
        done = true;
        onResult(pass);
      } catch (e) {
        if (done || ctrl.signal.reason === 'closed') return;
        setErr(
          e && e.name === 'NotAllowedError'
            ? "Camera access is needed to scan — you can still type the flight number."
            : e && e.message === 'parse'
              ? "That's not a boarding-pass barcode. Scan the wide one (usually at the bottom of the pass), not a square QR code."
              : "Couldn't read it — hold steady on the wide barcode in good light, or type the flight number."
        );
      }
    })();
    return () => {
      clearTimeout(timer);
      ctrl.abort('closed');
      window.removeEventListener('keydown', onKey);
    };
  }, [open, attempt]);
  if (!open) return null;
  return (
    <div className="scan-overlay" role="dialog" aria-modal="true" aria-label="Scan boarding pass">
      <video ref={videoRef} className="scan-video" playsInline muted aria-hidden="true"></video>
      <div className="scan-frame" aria-hidden="true"><div className="scan-guide"></div></div>
      <button className="iconbtn scan-cancel" onClick={onClose} aria-label="Cancel scan"><Ic.close aria-hidden="true" /></button>
      {err ? (
        <div className="scan-msg" role="alert">
          <div className="scan-panel">
            <p>{err}</p>
            <button className="btn" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
          </div>
        </div>
      ) : (
        <div className="scan-msg">
          <div className="scan-panel">
            <ScanGuideArt />
            <p className="scan-cap">Scan the <b>wide</b> barcode — not a square QR</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- Flight summary ----------------------------------------------------- */
function FlightSummary({ f }) {
  const dur = `${Math.floor(f.durationMin/60)}h ${String(f.durationMin%60).padStart(2,"0")}m`;
  return (
    <section className="summary" aria-label="Flight summary">
      <div className="toprow">
        <div className="flightno">
          {f.routeMode
            ? <><b>Your route</b><span>times as entered</span></>
            : <><b>{f.code}</b><span>{f.airline}</span></>}
        </div>
        <div className="date">{f.date}</div>
      </div>
      <div className="endpoints">
        <div className="endpoint from">
          <div className="code-iata display">{f.from.iata}</div>
          <div className="city">{f.from.city}</div>
          <div className="clock tnum">{f.dep.local} <span>{f.from.zone}</span></div>
          <div className="zone">{f.from.airport} · {f.from.gmt}</div>
        </div>
        <div className="routemid">
          <span className="dur tnum">{dur}</span>
          <div className="planeline"><span className="ln"></span><Ic.plane /><span className="ln"></span></div>
        </div>
        <div className="endpoint to">
          <div className="code-iata display">{f.to.iata}</div>
          <div className="city">{f.to.city}</div>
          <div className="clock tnum">{f.arr.local} <span>{f.to.zone}</span></div>
          <div className="zone">{f.to.airport} · {f.to.gmt}</div>
        </div>
      </div>
    </section>
  );
}

/* ---- Timezone reference banner ----------------------------------------- */
function TzBanner({ f }) {
  return (
    <div className="tzbanner" role="note">
      <Ic.globe aria-hidden="true" />
      <div>
        In the air, a prayer's headline time is <b>local sky time</b> — the sun's own time over the
        spot you're flying, which is what the prayer actually follows. The <b>same moment</b> is shown
        beneath in <b>{f.from.iata}</b> and <b>{f.to.iata}</b> clock time, so you can read it off any watch.
      </div>
    </div>
  );
}


/* ---- Qibla relative to the aircraft (plane + bearing marker) ----------- */
function PlaneQibla({ rel, color, size = 30 }) {
  // top-down aircraft, nose pointing up = the direction of travel; the accent
  // marker rides the rim at the qibla's bearing relative to that nose
  const plane = "M15 4 C15.7 4 16.1 5 16.1 6.6 L16.1 10.5 L24 15.5 L24 17.2 "
    + "L16.1 14.6 L16.1 19.5 L18.6 21.6 L18.6 22.9 L15 21.6 L11.4 22.9 "
    + "L11.4 21.6 L13.9 19.5 L13.9 14.6 L6 17.2 L6 15.5 L13.9 10.5 "
    + "L13.9 6.6 C13.9 5 14.3 4 15 4 Z";
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true" style={{ flexShrink: 0, display: "block" }}>
      <circle cx="15" cy="15" r="13.5" fill="none" stroke="var(--border)" strokeWidth="1" opacity="0.7" />
      <path d={plane} fill="var(--text-soft)" />
      <g transform={`rotate(${rel} 15 15)`}>
        <path d="M15 0.6 l2.6 4.4 h-5.2 z" fill={color || "var(--accent)"} />
      </g>
    </svg>
  );
}

/* ---- Qibla compass (legacy, kept for reference) ------------------------ */
const CARD8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const cardinalOf = (b) => CARD8[Math.round(((b % 360) / 45)) % 8];

function QiblaCompass({ bearing, color, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0, display: "block" }}>
      <circle cx="12" cy="12" r="10" fill="none" stroke="var(--border)" strokeWidth="1.5" />
      <text x="12" y="5.6" textAnchor="middle" fontSize="4.5" fill="var(--text-mute)">N</text>
      <g transform={`rotate(${bearing} 12 12)`}>
        <path d="M12 4 L15 13 L12 11 L9 13 Z" fill={color || "var(--accent)"} />
      </g>
      <circle cx="12" cy="12" r="1.4" fill="var(--text-mute)" />
    </svg>
  );
}

/* ---- Next-prayer live countdown ---------------------------------------- */
function NextPrayer({ prayers, order }) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const next = prayers.find(p => p.ms > now);
  if (!next) {
    return (
      <div className="nextp done" role="status">
        <div className="np-eyebrow">This journey</div>
        <div className="np-msg">All prayers for this flight have passed — <span className="ar">سفر مبارك</span></div>
      </div>
    );
  }
  const diff = next.ms - now;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  const left = h > 0 ? `${h}h ${String(m).padStart(2, "0")}m`
            : m > 0 ? `${m}m ${String(s).padStart(2, "0")}s`
            : `${s}s`;
  const color = COLOR[next.key];
  const est = next.estimated;
  const statusText = next.status === "inflight" ? "in flight" : next.status === "before" ? "before departure" : "after arrival";
  const zs = (order || Object.keys(next.zones)).map(i => next.zones[i]).filter(Boolean);
  return (
    <div className="nextp" role="status" aria-live="polite" style={{ "--dot": color }}>
      <div className="np-left">
        <div className="np-eyebrow">Next prayer{est ? " · estimated" : ""}</div>
        <div className="np-name">
          <span className="np-en">{next.en}</span>
          <span className="np-ar ar" aria-hidden="true">{next.ar}</span>
        </div>
        <div className="np-meta">{statusText} · {zs.map(z => `${z.iata} ${est ? "~" : ""}${z.time}`).join(" · ")}</div>
      </div>
      <div className="np-right">
        <div className="np-count tnum">{left}</div>
        <div className="np-sub">remaining</div>
      </div>
    </div>
  );
}

/* ---- Timezone switch removed — cards now show both zones equally -------- */

export { Ic, PRAYER_GLYPH, Header, SettingsSheet, GuideSheet, MethodSheet, FlightSummary, TzBanner, QiblaCompass, PlaneQibla, NextPrayer, cardinalOf, InstallNudge, IOSInstallSheet, ScanSheet };
