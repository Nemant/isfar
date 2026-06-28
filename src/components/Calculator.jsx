import React from 'react';
import { lookupRemote } from '../lib/data.js';
import { loadAirports } from '../lib/airports.js';
import { recordToUrl, parseShareParams, routeParamsToRecord } from '../lib/share-url.js';
import { upsertRecent, recentLabel } from '../lib/recents.js';
import { exportImage } from '../lib/export-card.js';
import { compute } from '../lib/engine.js';
import { parseBCBP } from '../lib/bcbp.js';
import { Header, SettingsSheet, GuideSheet, MethodSheet, FlightSummary, NextPrayer, Ic, InstallNudge, IOSInstallSheet, ScanSheet } from './components.jsx';
import { ArcTimeline } from './arc.jsx';
import { PrayerList } from './cards.jsx';
import { useTweaks, TweaksPanel, TweakSection, TweakSlider, TweakRadio } from './tweaks-panel.jsx';
import { RouteForm } from './route-form.jsx';

/* ===========================================================================
   Isfar — app shell: state machine + theme + tweaks
   states: landing · loading · results · error
   =========================================================================== */

// ?from=LHR&to=JED deep link (the /prayer-times/ route pages' CTA): open in
// route mode with both airports prefilled. Module scope is browser-only here
// (client:only island). Consumed once; the URL is cleaned up after mount.
const URL_PREFILL = (() => {
  try {
    const p = new URLSearchParams(window.location.search);
    const from = (p.get("from") || "").toUpperCase();
    const to = (p.get("to") || "").toUpperCase();
    if (/^[A-Z]{3}$/.test(from) && /^[A-Z]{3}$/.test(to) && from !== to) return { from, to };
  } catch (e) {}
  return null;
})();

// Full share intent (flight or route with all itinerary fields) — distinct
// from URL_PREFILL, which is the legacy from/to-only form prefill. When this
// is set we reconstruct the whole result on mount and KEEP the URL (shareable).
const SHARE_INTENT = (() => {
  try { return parseShareParams(window.location.search); }
  catch (e) { return null; }
})();
const { useState: useS, useEffect: useE, useRef: useR } = React;

const LOAD_MSGS = [
  "Finding your flight…",
  "Tracing the great-circle path…",
  "Placing the sun along the route…",
  "Calculating prayer times aloft…"
];

/* the device's current date as YYYY-MM-DD (local, not UTC) */
function todayISO() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/* resolve auto → light/dark from the OS colour-scheme preference */
function resolveTheme(theme) {
  if (theme !== "auto") return theme;
  try { return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; }
  catch (e) { return "light"; }
}

function Calculator() {
  const TWEAK_DEFAULTS = /*EDITMODE-START*/ {
    theme: "auto",
    warmth: 1.0
  } /*EDITMODE-END*/;
  // Theme is a real user setting persisted on the device (unlike the design-time
  // tweaks) — seed it from localStorage so a chosen theme survives reload.
  const savedTheme = (() => { try { return localStorage.getItem("isfar.theme"); } catch (e) { return null; } })();
  const [t, setTweak] = useTweaks(savedTheme ? { ...TWEAK_DEFAULTS, theme: savedTheme } : TWEAK_DEFAULTS);
  function setTheme(v) {
    setTweak("theme", v);
    try { localStorage.setItem("isfar.theme", v); } catch (e) {}
  }

  // prayer-calculation settings — real user settings, persisted on the device
  const [settings, setSettings] = useS(() => {
    const def = { method: "isna", madhab: "shafi" };
    try { return Object.assign(def, JSON.parse(localStorage.getItem("isfar.settings") || "{}")); }
    catch (e) { return def; }
  });
  function setSetting(key, val) {
    setSettings((prev) => {
      const next = Object.assign({}, prev, { [key]: val });
      try { localStorage.setItem("isfar.settings", JSON.stringify(next)); } catch (e) {}
      return next;
    });
  }
  const [showSettings, setShowSettings] = useS(false);
  const [showGuide, setShowGuide] = useS(false);
  const [showMethod, setShowMethod] = useS(false);
  const [showScan, setShowScan] = useS(false);
  const [scanPrefill, setScanPrefill] = useS(null); // route-mode offline prefill
  const canScan = (typeof navigator !== 'undefined') &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  const [view, setView] = useS("landing");      // landing|loading|results|error
  const [query, setQuery] = useS("");
  const [date, setDate] = useS(todayISO());
  // lookup mode: by flight number, or by route + itinerary times
  const [mode, setMode] = useS(() => {
    if (URL_PREFILL) return "route";             // deep link wins, not persisted
    try { return localStorage.getItem("isfar.lookupMode") === "route" ? "route" : "flight"; }
    catch (e) { return "flight"; }
  });
  // Mount: handle a shared/refreshed result URL, else scrub a legacy prefill.
  useE(() => {
    if (SHARE_INTENT && SHARE_INTENT.kind === "flight") {
      setDate(SHARE_INTENT.date);
      runFlightLookup(SHARE_INTENT.code, SHARE_INTENT.date, true);
    } else if (SHARE_INTENT && SHARE_INTENT.kind === "route") {
      switchMode("route");
      setDate(SHARE_INTENT.date);
      loadAirports().then((list) => {
        const rec = routeParamsToRecord(SHARE_INTENT, list);
        if (rec) showRecord(rec, { replace: true });
      }).catch(() => {});
    } else if (URL_PREFILL) {
      try { history.replaceState(null, "", window.location.pathname); } catch (e) {}
    }
  }, []);

  // Browser back/forward drives the view from the URL. No share params => the
  // landing screen; share params => rebuild that result (cache-first/offline).
  useE(() => {
    const onPop = () => {
      const intent = parseShareParams(window.location.search);
      if (!intent) {
        clearTimeout(loadTimer.current); loadTimer.current = null;
        setView("landing"); setRaw(null); setErr(null); setActiveKey(null);
        return;
      }
      if (intent.kind === "flight") runFlightLookup(intent.code, intent.date, true, true);
      else loadAirports().then((list) => {
        const rec = routeParamsToRecord(intent, list);
        if (rec) showRecord(rec, { replace: true, skipRecord: true });
      }).catch(() => {});
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  function switchMode(m) {
    setMode(m); setErr(null);
    try { localStorage.setItem("isfar.lookupMode", m); } catch (e) {}
  }
  const [err, setErr] = useS(null);              // field-level validation
  const [raw, setRaw] = useS(null);              // matched flight record
  const [loadMsg, setLoadMsg] = useS(0);
  const [activeKey, setActiveKey] = useS(null);
  const cardRefs = useR({});
  const loadTimer = useR(null);

  // recent searches — persisted locally so they're available offline
  const [recents, setRecents] = useS(() => {
    try { return JSON.parse(localStorage.getItem("isfar.recents") || "[]"); }
    catch (e) { return []; }
  });
  function recordRecent(rec) {
    setRecents((prev) => {
      const next = upsertRecent(prev, rec);
      try { localStorage.setItem("isfar.recents", JSON.stringify(next)); } catch (e) {}
      return next;
    });
    // ask the browser not to evict our storage — the whole point of saving
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
  }
  // tap a saved flight: full record stored → instant, zero network (airplane
  // mode); legacy code-only entries fall back to the normal lookup
  function openRecent(r) {
    if (r.rec && r.rec.found) {
      showRecord(r.rec);
      return;
    }
    submit(r.code);
  }
  function clearRecents() {
    setRecents([]);
    try { localStorage.removeItem("isfar.recents"); } catch (e) {}
  }

  // derive the live-computed model whenever the record or calc settings change
  const data = React.useMemo(() => {
    if (!raw || !raw.found) return raw;
    try { return compute(raw, { method: settings.method, madhab: settings.madhab }); }
    catch (e) { console.error("compute failed", e); return raw; }
  }, [raw, settings.method, settings.madhab]);


  const resolved = resolveTheme(t.theme);

  // When following the OS ("auto"), re-render if the system flips dark/light live.
  const [, bumpTheme] = useS(0);
  useE(() => {
    if (t.theme !== "auto" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => bumpTheme((n) => n + 1);
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, [t.theme]);

  // Keep the document themed in sync with the resolved theme. <html data-theme>
  // selects the CSS theme tokens (sky colours + color-scheme) in styles.css, so
  // just setting the attribute repaints the .sky gradient and the <html> canvas
  // backstop and re-tints Safari's native translucent bars — on every toggle and
  // live OS flip. No theme-color meta: that would turn those bars into solid
  // blocks the page can't scroll behind.
  useE(() => {
    document.documentElement.setAttribute("data-theme", resolved);
  }, [resolved]);

  // Each screen starts at the top — without this, results inherit however far
  // down the landing form the user had scrolled to press the button.
  useE(() => { window.scrollTo(0, 0); }, [view]);

  // apply warmth to the theme container
  const rootStyle = { "--warmth": t.warmth };

  // Two-state flip on the *visible* theme so a tap always changes what you see.
  // From "auto" this picks the opposite of whatever auto currently resolves to.
  // (auto stays the first-load default and is still selectable in the Tweaks panel.)
  function cycleTheme() {
    setTheme(resolved === "dark" ? "light" : "dark");
  }

  function goHome() {
    clearTimeout(loadTimer.current);
    loadTimer.current = null;            // invalidate any in-flight async lookup
    setView("landing"); setRaw(null); setErr(null); setActiveKey(null);
    setDate(todayISO());                 // the date field always defaults back to today
    // back to a clean root URL so the in-app Home and the browser Back agree
    try { history.replaceState(null, "", window.location.pathname); } catch (e) {}
  }

  // Show a resolved record as a result and sync the URL. replace:true is used
  // when bootstrapping from a shared/refreshed URL (don't add a history entry).
  function showRecord(rec, opts) {
    const replace = !!(opts && opts.replace);
    const skipRecord = !!(opts && opts.skipRecord);
    setErr(null);
    setQuery(rec.code || "");
    setRaw(rec);
    if (!skipRecord) recordRecent(rec);
    setView("results");
    try {
      const url = recordToUrl(rec, window.location.origin);
      if (replace) history.replaceState({ isfar: "result" }, "", url);
      else history.pushState({ isfar: "result" }, "", url);
    } catch (e) {}
  }

  // Core flight lookup (shared by user submit and URL bootstrap). Keeps the
  // calm minimum loading dwell; cache-first via lookupRemote (offline replay).
  function runFlightLookup(code, useDate, replace, skipRecord) {
    setErr(null);
    setQuery(code.toUpperCase());
    setView("loading"); setLoadMsg(0);

    let i = 0;
    const msgInt = setInterval(() => { i = Math.min(i + 1, LOAD_MSGS.length - 1); setLoadMsg(i); }, 620);

    const token = {};
    loadTimer.current = token;

    (async () => {
      const [res] = await Promise.all([
        lookupRemote(code, useDate),
        new Promise((r) => setTimeout(r, replace ? 0 : 1200))
      ]);
      clearInterval(msgInt);
      if (loadTimer.current !== token) return;   // user navigated away mid-load
      if (!res.found) { setRaw(res); setView("error"); return; }
      showRecord(res, { replace, skipRecord });
    })();
  }

  function submit(rawArg, dateArg) {
    const raw = (typeof rawArg === "string" ? rawArg : query).trim();
    if (!raw) { setErr("Enter a flight number to continue."); return; }
    // dateArg lets the sample chips look up at their own demo date (which now
    // matters: a sample code is only served from the local table at that date).
    runFlightLookup(raw, dateArg || date, false);
  }

  // A boarding pass was scanned & parsed → { code, dateISO, fromIata, toIata }.
  // Flight mode: straight to the lookup. Route mode: look up if online (richer,
  // the barcode has the flight number), else prefill the route form so the user
  // can finish offline (the barcode carries no times).
  function onScanResult(pass) {
    setShowScan(false);
    setDate(pass.dateISO);
    if (mode === 'flight' || navigator.onLine) {
      runFlightLookup(pass.code, pass.dateISO, false);
    } else {
      setScanPrefill({ from: pass.fromIata, to: pass.toIata, n: Date.now() });
    }
  }

  // PWA install nudge — captured native prompt (Chrome/Android) or iOS steps;
  // on every results screen until installed (never when already standalone);
  // the ✕ only rests it for this session — saving offline is the app's point
  const [installEvt, setInstallEvt] = useS(null);
  const [nudgeGone, setNudgeGone] = useS(false);
  const [showIOSHelp, setShowIOSHelp] = useS(false);
  useE(() => {
    try { localStorage.removeItem("isfar.installNudge"); } catch (e) {} // pre-v21 "shown once" flag
    const onPrompt = (e) => { e.preventDefault(); setInstallEvt(e); };
    const onInstalled = () => dismissNudge();
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  function dismissNudge() { setNudgeGone(true); }
  const standalone = (typeof window !== "undefined") &&
    ((window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true);
  const isIOS = (typeof navigator !== "undefined") && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const canNudge = !nudgeGone && !standalone && (!!installEvt || isIOS);
  async function installApp() {
    if (installEvt) {
      installEvt.prompt();
      const { outcome } = await installEvt.userChoice;
      if (outcome === "accepted") dismissNudge();
      setInstallEvt(null);
    } else {
      setShowIOSHelp(true);
    }
  }

  // a route record is already resolved locally — same calm loading dwell, no lookup
  function submitRecord(rec) {
    setQuery(rec.code); setView("loading"); setLoadMsg(0);
    let i = 0;
    const msgInt = setInterval(() => { i = Math.min(i + 1, LOAD_MSGS.length - 1); setLoadMsg(i); }, 620);
    const token = {}; loadTimer.current = token;
    setTimeout(() => {
      clearInterval(msgInt);
      if (loadTimer.current !== token) return;
      showRecord(rec);
    }, 1200);
  }

  function selectPrayer(key) {
    setActiveKey(key);
    const el = cardRefs.current[key];
    if (el && el.scrollIntoView) {
      // gentle: align without hijacking the whole page
      const r = el.getBoundingClientRect();
      const top = window.scrollY + r.top - window.innerHeight * 0.35;
      window.scrollTo({ top, behavior: "smooth" });
    }
    setTimeout(() => setActiveKey((k) => (k === key ? null : k)), 1600);
  }

  useE(() => () => clearTimeout(loadTimer.current), []);

  return (
    <div className="isfar" data-theme={resolved} style={rootStyle}>
      <div className="sky" aria-hidden="true"></div>
      <div className="col">
        <Header theme={resolved} onCycleTheme={cycleTheme} onHome={goHome} onOpenSettings={() => setShowSettings(true)} onOpenGuide={() => setShowGuide(true)} onOpenMethod={() => setShowMethod(true)} />

        {view === "landing"  && <Landing query={query} setQuery={setQuery} date={date} setDate={setDate}
                                          err={err} onSubmit={submit}
                                          recents={recents} onClearRecents={clearRecents}
                                          onOpenRecent={openRecent}
                                          mode={mode} onSwitchMode={switchMode}
                                          onSubmitRecord={submitRecord}
                                          canScan={canScan} onScan={() => setShowScan(true)}
                                          scanPrefill={scanPrefill} />}
        {view === "loading"  && <Loading query={query} msg={LOAD_MSGS[loadMsg]} />}
        {view === "results"  && <Results f={data} settings={settings} activeKey={activeKey} selectPrayer={selectPrayer}
                                         cardRefs={cardRefs} onBack={goHome}
                                         nudge={canNudge ? <InstallNudge onInstall={installApp} onDismiss={dismissNudge} /> : null} />}
        {view === "error"    && <ErrorState code={raw && raw.code} kind={raw && raw.error}
                                            onRetry={goHome} />}

        <TweaksPanel>
          <TweakSection label="Appearance" />
          <TweakRadio label="Theme" value={t.theme}
                      options={["light", "dark", "auto"]}
                      onChange={(v) => setTheme(v)} />
          <TweakSlider label="Accent warmth" value={t.warmth} min={0.2} max={1.6} step={0.05}
                       onChange={(v) => setTweak("warmth", v)} />
        </TweaksPanel>

        <SettingsSheet open={showSettings} onClose={() => setShowSettings(false)}
                       method={settings.method} madhab={settings.madhab} onChange={setSetting} />
        <GuideSheet open={showGuide} onClose={() => setShowGuide(false)} />
        <MethodSheet open={showMethod} onClose={() => setShowMethod(false)} />
        <IOSInstallSheet open={showIOSHelp} onClose={() => setShowIOSHelp(false)} />
        <ScanSheet open={showScan} onClose={() => setShowScan(false)} onResult={onScanResult} parse={parseBCBP} />
      </div>
    </div>
  );
}

/* ---- Landing ------------------------------------------------------------ */
function Landing({ query, setQuery, date, setDate, err, onSubmit, recents, onClearRecents, onOpenRecent,
                   mode, onSwitchMode, onSubmitRecord, canScan, onScan, scanPrefill }) {
  const inputRef = useR(null);
  useE(() => { if (mode === "flight" && inputRef.current) inputRef.current.focus({ preventScroll: true }); }, [mode]);
  // date pinned to each sample's own demo date so the curated record (its edge
  // case) resolves from the local table; without it the chip would hit the live API.
  const examples = [
    { code: "SV124", label: "London → Jeddah", date: "2026-06-06" },
    { code: "QF10", label: "London → Perth · 9 prayers", date: "2026-06-06" },
    { code: "EK215", label: "Dubai → LA · stretched day", date: "2026-06-06" },
    { code: "DY394", label: "Oslo → Tromsø · midnight sun", date: "2026-06-06" }
  ];
  return (
    <main className="landing">
      <div className="hero">
        {/* h2: the document h1 is the static sr-only one in index.astro */}
        <h2 className="display">Know your prayers from gate to gate.</h2>
      </div>

      <div className="horizon" aria-hidden="true"></div>

      <div className="set-seg mode-seg" role="group" aria-label="Look up by">
        {[{ v: "flight", l: "Flight number" }, { v: "route", l: "Route" }].map((o) => (
          <button key={o.v} type="button" className={"set-opt" + (mode === o.v ? " active" : "")}
                  aria-pressed={mode === o.v} onClick={() => onSwitchMode(o.v)}>{o.l}</button>
        ))}
      </div>

      {mode === "flight" ? (
        <form className="form" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
          <div className="field">
            <label htmlFor="flight">Flight number</label>
            <div className="input-wrap">
              <input id="flight" ref={inputRef} className="input" type="text" inputMode="text"
                     autoComplete="off" autoCapitalize="characters" spellCheck="false"
                     placeholder="SV124" value={query}
                     aria-invalid={!!err} aria-describedby={err ? "flight-err" : "flight-help"}
                     onChange={(e) => setQuery(e.target.value)} />
            </div>
            {err
              ? <div className="field-error" id="flight-err"><Ic.alert style={{width:15,height:15}} aria-hidden="true" />{err}</div>
              : null}
          </div>

          <div className="field">
            <div className="label-row">
              <label htmlFor="date">Date of travel</label>
              {date !== todayISO() ? (
                <button type="button" className="today-btn" onClick={() => setDate(todayISO())}>Today</button>
              ) : null}
            </div>
            <input id="date" className="input compact" type="date" value={date}
                   onChange={(e) => setDate(e.target.value)} />
          </div>

          <button className="btn" type="submit">
            Find my prayer times <Ic.arrow aria-hidden="true" />
          </button>
          {canScan ? (
            <button type="button" className="btn-ghost scan-entry" onClick={onScan}>
              <Ic.camera style={{ width: 16, height: 16 }} aria-hidden="true" /> Scan boarding pass
            </button>
          ) : null}
          <div className="offline-note"><Ic.plane aria-hidden="true" /> Look up once — your flights then work offline</div>
        </form>
      ) : (
        <RouteForm date={date} setDate={setDate} todayISO={todayISO} onSubmitRecord={onSubmitRecord}
                   prefill={URL_PREFILL} canScan={canScan} onScan={onScan} scanPrefill={scanPrefill}
                   onScanPrefillConsumed={() => setScanPrefill(null)} />
      )}

      <div className="form form-tail">
        {recents && recents.length ? (
          <div className="recents">
            <div className="recents-head">
              <span>Saved flights <em>· work offline</em></span>
              <button type="button" className="recents-clear" onClick={onClearRecents}>Clear</button>
            </div>
            <div className="recents-list">
              {recents.map((r) => (
                <button type="button" key={(r.code || "") + (r.dateISO || "")} className="recent"
                        onClick={() => onOpenRecent(r)}>
                  <span className="recent-code">{r.code}</span>
                  <span className="recent-route">{recentLabel(r)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="helper" id="flight-help">Try a sample route:</div>
        <div className="examples">
          {examples.map((ex) => (
            <button type="button" key={ex.code} className="chip"
                    onClick={() => { setQuery(ex.code); onSubmit(ex.code, ex.date); }}>
              {ex.code} <b>· {ex.label}</b>
            </button>
          ))}
        </div>
      </div>

      <Foot />
    </main>
  );
}

/* ---- Loading ------------------------------------------------------------ */
function Loading({ query, msg }) {
  return (
    <main className="loading" aria-live="polite" aria-busy="true">
      <div className="arcwrap">
        <svg viewBox="0 0 330 170" width="100%" aria-hidden="true">
          <line x1="10" y1="150" x2="320" y2="150" stroke="var(--border-2)" strokeWidth="1" />
          <path className="load-track" d="M 24 150 Q 165 14 306 150" />
          <path className="load-fill"  d="M 24 150 Q 165 14 306 150" />
          <circle className="load-sun" r="6" cx="0" cy="0" />
        </svg>
      </div>
      <div>
        <div className="display">{query}</div>
        <div className="lroute">flight lookup</div>
      </div>
      <div className="lstatus">{msg}</div>
    </main>
  );
}

/* ---- Results ------------------------------------------------------------ */
function Results({ f, settings, activeKey, selectPrayer, cardRefs, onBack, nudge }) {
  const [exportErr, setExportErr] = useS(false);
  const [shared, setShared] = useS(false);
  async function shareLink() {
    const url = recordToUrl(f, window.location.origin);
    try {
      if (navigator.share) { await navigator.share({ url }); return; }
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 1800);
    } catch (e) { /* user cancelled share or clipboard blocked — no-op */ }
  }
  async function saveImage() {
    setExportErr(false);
    try { await exportImage(f, settings, document.querySelector(".isfar")); }
    catch (e) { console.error("export failed", e); setExportErr(true); }
  }
  return (
    <main className="results">
      {nudge}
      <NextPrayer prayers={f.prayers} order={[f.from.iata, f.to.iata]} />
      <FlightSummary f={f} />
      <div className="saved-note" role="note"><Ic.auto aria-hidden="true" /> Saved on this device — available offline</div>
      {(f.skyNotes || []).map((n) => (
        <div className="midnight-banner" role="note" key={n.place}>
          <Ic.sunrise aria-hidden="true" />
          {n.kind === "shortnight" ? (
            <span>The night at <b>{n.city}</b> ({n.latitude}) is only {n.nightMin} minutes long — the ~ times follow that real, short night; Maghrib and Isha may be combined. <a className="banner-link" href="/guide/far-north-prayer-times/">How we estimate these times</a></span>
          ) : (
            <span>The sun {n.kind === "polarnight" ? "won’t rise" : "won’t set"} at <b>{n.city}</b> ({n.latitude}) — {n.allEstimated ? "prayer times there are estimated" : "some prayer times there are estimates"}. <a className="banner-link" href="/guide/far-north-prayer-times/">How we estimate these times</a></span>
          )}
        </div>
      ))}
      <ArcTimeline f={f} activeKey={activeKey} onSelect={selectPrayer} />
      <PrayerList f={f} activeKey={activeKey} cardRefs={cardRefs} />
      <div className="results-actions">
        <button className="btn" onClick={onBack}><Ic.back style={{width:16,height:16}} aria-hidden="true" /> Look up another flight</button>
        <button className="btn-ghost" onClick={saveImage}><Ic.download style={{width:16,height:16}} aria-hidden="true" /> Save as image</button>
        <button className="btn-ghost" onClick={shareLink}><Ic.share style={{width:16,height:16}} aria-hidden="true" /> {shared ? "Link copied" : "Share link"}</button>
      </div>
      {exportErr ? <div className="field-error">Couldn’t create the image on this browser.</div> : null}
      <Foot />
    </main>
  );
}

/* ---- Error -------------------------------------------------------------- */
function ErrorState({ code, kind, onRetry }) {
  const heading =
    kind === "format"  ? "That doesn’t look like a flight number" :
    kind === "offline" ? "You’re offline" :
    kind === "busy"    ? "Just a moment" :
                         "We couldn’t find that flight";
  const body =
    kind === "format"  ? <>A flight number is an airline code plus digits — like <span className="code">SV124</span> or <span className="code">BA286</span>.</> :
    kind === "offline" ? <>Saved flights still work — connect to look up a new one.</> :
    kind === "busy"    ? <>Lots of lookups right now. Please try again in a moment.</> :
                         <>We searched for <span className="code">{code}</span> but found no matching flight for this date. Check the number and date, then try again.</>;
  return (
    <main className="state-card">
      <div className="state-ic"><Ic.plane aria-hidden="true" /></div>
      <h2 className="display">{heading}</h2>
      <p>{body}</p>
      <div className="state-actions">
        <button className="btn" onClick={onRetry}><Ic.back style={{width:16,height:16}} aria-hidden="true" /> Try another flight</button>
      </div>
      <Foot />
    </main>
  );
}

/* ---- Footer ------------------------------------------------------------- */
function Foot() {
  return (
    <footer className="foot">
      <span className="ar" aria-hidden="true">سفر مبارك</span>
    </footer>
  );
}

export default Calculator;
