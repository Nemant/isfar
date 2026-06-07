/* ===========================================================================
   Rihla — app shell: state machine + theme + tweaks
   states: landing · loading · results · error · nosunset
   =========================================================================== */
const { useState: useS, useEffect: useE, useRef: useR } = React;

const LOAD_MSGS = [
  "Finding your flight…",
  "Tracing the great-circle path…",
  "Placing the sun along the route…",
  "Calculating prayer times aloft…"
];

/* resolve auto → light/dark from the local hour (proxy for sun up/down) */
function resolveTheme(theme) {
  if (theme !== "auto") return theme;
  const h = new Date().getHours();
  return (h >= 7 && h < 19) ? "light" : "dark";
}

function App() {
  const TWEAK_DEFAULTS = /*EDITMODE-START*/ {
    theme: "auto",
    warmth: 1.0
  } /*EDITMODE-END*/;
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // prayer-calculation settings — real user settings, persisted on the device
  const [settings, setSettings] = useS(() => {
    const def = { method: "isna", madhab: "shafi" };
    try { return Object.assign(def, JSON.parse(localStorage.getItem("rihla.settings") || "{}")); }
    catch (e) { return def; }
  });
  function setSetting(key, val) {
    setSettings((prev) => {
      const next = Object.assign({}, prev, { [key]: val });
      try { localStorage.setItem("rihla.settings", JSON.stringify(next)); } catch (e) {}
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

  // recent searches — persisted locally so they're available offline
  const [recents, setRecents] = useS(() => {
    try { return JSON.parse(localStorage.getItem("rihla.recents") || "[]"); }
    catch (e) { return []; }
  });
  function recordRecent(rec) {
    const item = {
      code: rec.code, airline: rec.airline,
      fromIata: rec.from.iata, fromCity: rec.from.city,
      toIata: rec.to.iata, toCity: rec.to.city, ts: Date.now()
    };
    setRecents((prev) => {
      const next = [item, ...prev.filter((r) => r.code !== item.code)].slice(0, 6);
      try { localStorage.setItem("rihla.recents", JSON.stringify(next)); } catch (e) {}
      return next;
    });
  }
  function clearRecents() {
    setRecents([]);
    try { localStorage.removeItem("rihla.recents"); } catch (e) {}
  }

  // derive the live-computed model whenever the record or calc settings change
  const data = React.useMemo(() => {
    if (!raw || !raw.found) return raw;
    try { return window.RIHLA_ENGINE.compute(raw, { method: settings.method, madhab: settings.madhab }); }
    catch (e) { console.error("compute failed", e); return raw; }
  }, [raw, settings.method, settings.madhab]);

  useE(() => {
    if (!data || !data.found) return;
    if (view === "results" && data.noSunset) setView("nosunset");
    else if (view === "nosunset" && !data.noSunset) setView("results");
  }, [data]);

  const resolved = resolveTheme(t.theme);

  // apply warmth to the theme container
  const rootStyle = { "--warmth": t.warmth };

  function cycleTheme() {
    const order = { light: "dark", dark: "auto", auto: "light" };
    setTweak("theme", order[t.theme]);
  }

  function goHome() {
    clearTimeout(loadTimer.current);
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

    loadTimer.current = setTimeout(() => {
      clearInterval(msgInt);
      const res = window.RIHLA_DATA.lookup(raw);
      setRaw(res);
      if (!res.found) { setView("error"); return; }
      recordRecent(res);
      let model; try { model = window.RIHLA_ENGINE.compute(res, { method: settings.method, madhab: settings.madhab }); } catch (e) { model = res; }
      setView(model && model.noSunset ? "nosunset" : "results");
    }, 2350);
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
    <div className="rihla" data-theme={resolved} style={rootStyle}>
      <div className="sky" aria-hidden="true"></div>
      <div className="col">
        <Header theme={t.theme} onCycleTheme={cycleTheme} onHome={goHome} onOpenSettings={() => setShowSettings(true)} onOpenGuide={() => setShowGuide(true)} onOpenMethod={() => setShowMethod(true)} />

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
                      onChange={(v) => setTweak("theme", v)} />
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
  const isFormat = kind === "format";
  return (
    <main className="state-card">
      <div className="state-ic"><Ic.plane aria-hidden="true" /></div>
      <h2 className="display">{isFormat ? "That doesn’t look like a flight number" : "We couldn’t find that flight"}</h2>
      <p>
        {isFormat
          ? <>A flight number is an airline code plus digits — like <span className="code">SV124</span> or <span className="code">BA286</span>.</>
          : <>We searched for <span className="code">{code}</span> but found no matching flight for this date. Check the number and date, then try again.</>}
      </p>
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

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
