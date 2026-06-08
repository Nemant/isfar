/* ===========================================================================
   Isfar — app shell: state machine + theme + tweaks
   states: landing · loading · results · error · nosunset

   ES-module port: this is the SINGLE React island (`Calculator`) hydrated
   client:load by Astro. It is the exact former `#root` tree from app.jsx, with
   `window.*` globals replaced by ES imports and the bottom createRoot() call
   removed (Astro mounts it). All state, props, localStorage keys, and the
   EDITMODE tweak-defaults marker are preserved.
   =========================================================================== */
import React, { useState, useEffect, useRef } from "react";
import * as ISFAR_DATA from "../lib/data.js";
import { compute } from "../lib/engine.js";
import { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakSlider } from "./tweaks-panel.jsx";
import {
  Ic, Header, SettingsSheet, GuideSheet, MethodSheet,
  FlightSummary, NextPrayer
} from "./components.jsx";
import { ArcTimeline } from "./arc.jsx";
import { PrayerList } from "./cards.jsx";

const useS = useState, useE = useEffect, useR = useRef;

const LOAD_MSGS = [
  "Finding your flight…",
  "Tracing the great-circle path…",
  "Placing the sun along the route…",
  "Calculating prayer times aloft…"
];

/* resolve auto → light/dark from the OS colour-scheme preference */
function resolveTheme(theme) {
  if (theme !== "auto") return theme;
  try { return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; }
  catch (e) { return "light"; }
}

export default function App() {
  const TWEAK_DEFAULTS = /*EDITMODE-START*/ {
    theme: "auto",
    warmth: 1.0
  } /*EDITMODE-END*/;
  // Theme is a real user setting persisted on the device (unlike the design-time
  // tweaks). It's loaded from localStorage in a mount effect below — NOT during
  // the initial render — so the first client render matches the server-rendered
  // HTML and React hydrates cleanly (see the hydration effect after recents).
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  function setTheme(v) {
    setTweak("theme", v);
    try { localStorage.setItem("isfar.theme", v); } catch (e) {}
  }

  // prayer-calculation settings — real user settings, persisted on the device.
  // Initialised to defaults; the saved values are loaded in the mount effect
  // below (not in render) to keep server and first client render identical.
  const [settings, setSettings] = useS({ method: "isna", madhab: "shafi" });
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

  const [view, setView] = useS("landing");      // landing|loading|results|error|nosunset
  const [query, setQuery] = useS("");
  const [date, setDate] = useS("2026-06-06");
  const [err, setErr] = useS(null);              // field-level validation
  const [raw, setRaw] = useS(null);              // matched flight record
  const [loadMsg, setLoadMsg] = useS(0);
  const [activeKey, setActiveKey] = useS(null);
  const cardRefs = useR({});
  const loadTimer = useR(null);

  // recent searches — persisted locally so they're available offline. Loaded in
  // the mount effect below (not in render) to avoid a hydration mismatch.
  const [recents, setRecents] = useS([]);
  function recordRecent(rec) {
    const item = {
      code: rec.code, airline: rec.airline,
      fromIata: rec.from.iata, fromCity: rec.from.city,
      toIata: rec.to.iata, toCity: rec.to.city, ts: Date.now()
    };
    setRecents((prev) => {
      const next = [item, ...prev.filter((r) => r.code !== item.code)].slice(0, 6);
      try { localStorage.setItem("isfar.recents", JSON.stringify(next)); } catch (e) {}
      return next;
    });
  }
  function clearRecents() {
    setRecents([]);
    try { localStorage.removeItem("isfar.recents"); } catch (e) {}
  }

  // Hydrate persisted device state (theme, calc settings, recents) AFTER mount.
  // Astro server-renders this island at build time with empty localStorage, so
  // reading it during the initial render would make the first client render
  // diverge from the server HTML and trip a hydration mismatch for any returning
  // user. Loading it in a mount-only effect keeps hydration clean; the values
  // apply one frame later via a normal state update.
  useE(() => {
    try {
      const savedTheme = localStorage.getItem("isfar.theme");
      if (savedTheme) setTweak("theme", savedTheme);
    } catch (e) {}
    try {
      const s = JSON.parse(localStorage.getItem("isfar.settings") || "null");
      if (s && typeof s === "object") setSettings((prev) => Object.assign({}, prev, s));
    } catch (e) {}
    try {
      const r = JSON.parse(localStorage.getItem("isfar.recents") || "null");
      if (Array.isArray(r) && r.length) setRecents(r);
    } catch (e) {}
  }, []);

  // Gate theme-dependent DOM/render until after mount. Until then the inline
  // <head> script (set-theme-before-paint) owns the visual theme; React must not
  // render or sync a theme that differs from the server HTML (it would flash /
  // mismatch). Flips true in the same commit the saved theme loads above.
  const [mounted, setMounted] = useS(false);
  useE(() => { setMounted(true); }, []);

  // derive the live-computed model whenever the record or calc settings change
  const data = React.useMemo(() => {
    if (!raw || !raw.found) return raw;
    try { return compute(raw, { method: settings.method, madhab: settings.madhab }); }
    catch (e) { console.error("compute failed", e); return raw; }
  }, [raw, settings.method, settings.madhab]);

  useE(() => {
    if (!data || !data.found) return;
    if (view === "results" && data.noSunset) setView("nosunset");
    else if (view === "nosunset" && !data.noSunset) setView("results");
  }, [data]);

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

  // Keep the document in sync with the resolved theme on every change (toggles,
  // live OS flips). The theme lives on <html data-theme> — CSS reads it from the
  // root and the inline <head> script set it before first paint — so we update
  // documentElement, not a React-rendered attribute. Also paint the html/body
  // canvas to the sky's bottom colour (the .sky backdrop is position:fixed and
  // only covers the viewport, so iOS overscroll/notch would otherwise flash
  // white), and narrow the browser-chrome <meta theme-color> to the resolved
  // theme's sky-top colour (hex matches styles.css --bg-top per theme).
  // Gated on `mounted`: until then the inline head script owns these, and the
  // pre-localStorage "auto" theme would otherwise briefly fight it.
  useE(() => {
    if (!mounted) return;
    document.documentElement.setAttribute("data-theme", resolved);
    const el = document.querySelector(".isfar");
    if (el) {
      const bg = getComputedStyle(el).getPropertyValue("--bg-bottom").trim();
      if (bg) {
        document.documentElement.style.background = bg;
        document.body.style.background = bg;
      }
    }
    const topHex = resolved === "dark" ? "#13132a" : "#c7e1fb";
    const metas = document.querySelectorAll('meta[name="theme-color"]');
    metas.forEach((m, i) => {
      if (i === 0) { m.removeAttribute("media"); m.setAttribute("content", topHex); }
      else m.remove();
    });
  }, [mounted, resolved, t.warmth]);

  // apply warmth to the theme container (default until mount to match the server)
  const rootStyle = { "--warmth": mounted ? t.warmth : 1 };

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
  }

  function submit(rawArg) {
    const raw = (typeof rawArg === "string" ? rawArg : query).trim();
    if (!raw) { setErr("Enter a flight number to continue."); return; }
    setErr(null);
    setQuery(raw.toUpperCase());
    setView("loading"); setLoadMsg(0);

    // cycle loading messages
    let i = 0;
    const msgInt = setInterval(() => { i = Math.min(i + 1, LOAD_MSGS.length - 1); setLoadMsg(i); }, 620);

    // token marks this run live; goHome() nulls it to drop a stale resolution
    const token = {};
    loadTimer.current = token;

    // Await the lookup AND a minimum calm dwell so the loading animation never
    // feels jarring — whichever finishes last gates the transition.
    (async () => {
      const [res] = await Promise.all([
        ISFAR_DATA.lookupRemote(raw, date),
        new Promise((r) => setTimeout(r, 1200))
      ]);
      clearInterval(msgInt);
      if (loadTimer.current !== token) return;   // user navigated away mid-load
      setRaw(res);
      if (!res.found) { setView("error"); return; }
      recordRecent(res);
      let model; try { model = compute(res, { method: settings.method, madhab: settings.madhab }); } catch (e) { model = res; }
      setView(model && model.noSunset ? "nosunset" : "results");
    })();
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
    <div className="isfar" style={rootStyle}>
      <div className="sky" aria-hidden="true"></div>
      <div className="col">
        <Header theme={mounted ? resolved : "light"} onCycleTheme={cycleTheme} onHome={goHome} onOpenSettings={() => setShowSettings(true)} onOpenGuide={() => setShowGuide(true)} onOpenMethod={() => setShowMethod(true)} />

        {view === "landing"  && <Landing query={query} setQuery={setQuery} date={date} setDate={setDate}
                                          err={err} onSubmit={submit}
                                          recents={recents} onClearRecents={clearRecents} />}
        {view === "loading"  && <Loading query={query} msg={LOAD_MSGS[loadMsg]} />}
        {view === "results"  && <Results f={data} activeKey={activeKey} selectPrayer={selectPrayer}
                                         cardRefs={cardRefs} onBack={goHome} />}
        {view === "error"    && <ErrorState code={raw && raw.code} kind={raw && raw.error}
                                            onRetry={goHome} />}
        {view === "nosunset" && <NoSunset f={data} onBack={goHome} />}

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
      </div>
    </div>
  );
}

/* ---- Landing ------------------------------------------------------------ */
function Landing({ query, setQuery, date, setDate, err, onSubmit, recents, onClearRecents }) {
  const inputRef = useR(null);
  useE(() => { if (inputRef.current) inputRef.current.focus({ preventScroll: true }); }, []);
  const examples = [
    { code: "SV124", label: "London → Jeddah" },
    { code: "QF10", label: "London → Perth · 9 prayers" },
    { code: "EK215", label: "Dubai → LA · stretched day" },
    { code: "DY394", label: "Oslo → Tromsø · midnight sun" }
  ];
  return (
    <main className="landing">
      <div className="hero">
        <h1 className="display">Know your prayers from gate to gate.</h1>
      </div>

      <div className="horizon" aria-hidden="true"></div>

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
          <label htmlFor="date">Date of travel</label>
          <input id="date" className="input compact" type="date" value={date}
                 onChange={(e) => setDate(e.target.value)} />
        </div>

        <button className="btn" type="submit">
          Find my prayer times <Ic.arrow aria-hidden="true" />
        </button>
        <div className="offline-note"><Ic.plane aria-hidden="true" /> Look up once — your flights then work offline</div>

        {recents && recents.length ? (
          <div className="recents">
            <div className="recents-head">
              <span>Recent flights <em>· saved on this device</em></span>
              <button type="button" className="recents-clear" onClick={onClearRecents}>Clear</button>
            </div>
            <div className="recents-list">
              {recents.map((r) => (
                <button type="button" key={r.code} className="recent"
                        onClick={() => onSubmit(r.code)}>
                  <span className="recent-code">{r.code}</span>
                  <span className="recent-route">{r.fromIata} → {r.toIata}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="helper" id="flight-help">Try a sample route:</div>
        <div className="examples">
          {examples.map((ex) => (
            <button type="button" key={ex.code} className="chip"
                    onClick={() => { setQuery(ex.code); onSubmit(ex.code); }}>
              {ex.code} <b>· {ex.label}</b>
            </button>
          ))}
        </div>
      </form>

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
function Results({ f, activeKey, selectPrayer, cardRefs, onBack }) {
  return (
    <main className="results">
      <NextPrayer prayers={f.prayers} order={[f.from.iata, f.to.iata]} />
      <FlightSummary f={f} />
      <ArcTimeline f={f} activeKey={activeKey} onSelect={selectPrayer} />
      <PrayerList f={f} activeKey={activeKey} cardRefs={cardRefs} />
      <button className="btn" onClick={onBack} style={{ marginTop: 8 }}><Ic.back style={{width:16,height:16}} aria-hidden="true" /> Look up another flight</button>
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

/* ---- No-sunset edge case ----------------------------------------------- */
function NoSunset({ f, onBack }) {
  const undef = f.undefinedPrayers || [];
  const names = undef.map(p => p.en);
  const joined = names.length <= 1 ? names.join("")
    : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  return (
    <main className="state-card">
      <div className="state-ic"><Ic.sunrise aria-hidden="true" /></div>
      <h2 className="display">The sun won’t set on this route</h2>
      <p>
        {f.code} flies to <b>{f.to.city}</b> at <b>{f.latitude}</b>. In midsummer the sun stays above the
        horizon, so <b>{joined}</b> {names.length > 1 ? "have" : "has"} no calculated time here.
      </p>
      <div className="nosunset-card">
        {f.defined.map((p) => (
          <div className="ns-row" key={p.key}>
            <span>{p.en} <span className="ar" aria-hidden="true">{p.ar}</span></span>
            <span className="tnum">{p.time} <em>· {p.note}</em></span>
          </div>
        ))}
        {f.undefinedPrayers.map((p) => (
          <div className="ns-row" key={p.key}>
            <span>{p.en} <span className="ar" aria-hidden="true">{p.ar}</span></span>
            <em>{p.key === "fajr" ? "no true dawn" : "no true sunset"}</em>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 13.5, color: "var(--text-mute)", maxWidth: "34ch" }}>
        Scholars differ on high-latitude timings — many follow the nearest moderate latitude or the times
        of the last place the sun set. Follow the guidance you trust.
      </p>
      <div className="state-actions">
        <button className="btn" onClick={onBack}><Ic.back style={{width:16,height:16}} aria-hidden="true" /> Look up another flight</button>
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
      Safe travels. Times are guidance for travellers — verify with a local source on arrival.
    </footer>
  );
}
