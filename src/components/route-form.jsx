import React from 'react';
import { loadAirports, searchAirports, airportFromRow, routeRecord } from '../lib/airports.js';
import { Ic } from './components.jsx';

/* ===========================================================================
   Isfar — route mode form: no flight number, just the itinerary.
   From/To comboboxes over the bundled airport dataset (instant, offline),
   departure + arrival local times, shared date. The live duration line is the
   safety net for a wrong-day arrival.
   =========================================================================== */
const { useState: useS, useEffect: useE, useRef: useR } = React;

/* ---- one airport combobox ----------------------------------------------- */
function AirportField({ id, label, placeholder, list, value, onPick }) {
  const [text, setText] = useS(value ? `${value.iata} — ${value.city}` : '');
  const [hits, setHits] = useS([]);
  const [open, setOpen] = useS(false);
  const [hi, setHi] = useS(0);
  const wrapRef = useR(null);

  // reflect an externally-set value (e.g. the ?from=&to= deep-link prefill,
  // which resolves only after the dataset loads). Typing clears value to null,
  // which deliberately does NOT wipe the text being typed.
  useE(() => { if (value) setText(`${value.iata} — ${value.city}`); }, [value]);

  useE(() => {
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, []);

  function onInput(v) {
    setText(v); onPick(null);
    const h = list ? searchAirports(list, v) : [];
    setHits(h); setHi(0); setOpen(h.length > 0);
  }
  function pick(row) {
    const a = airportFromRow(row);
    onPick(a); setText(`${a.iata} — ${a.city}`); setOpen(false);
  }
  function onKey(e) {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((i) => Math.min(i + 1, hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (hits[hi]) pick(hits[hi]); }
    else if (e.key === 'Escape') setOpen(false);
  }
  return (
    <div className="field" ref={wrapRef}>
      <label htmlFor={id}>{label}</label>
      <div className="input-wrap">
        <input id={id} className="input combo" type="text" autoComplete="off" spellCheck="false"
               role="combobox" aria-expanded={open} aria-controls={id + '-list'} aria-autocomplete="list"
               placeholder={placeholder} value={text}
               onChange={(e) => onInput(e.target.value)} onKeyDown={onKey}
               onFocus={() => { if (hits.length && !value) setOpen(true); }} />
        {open ? (
          <ul className="ac-list" id={id + '-list'} role="listbox">
            {hits.map((row, i) => (
              <li key={row[0]} role="option" aria-selected={i === hi}
                  className={'ac-item' + (i === hi ? ' hi' : '')}
                  onPointerDown={(e) => { e.preventDefault(); pick(row); }}>
                <b>{row[0]}</b> {row[1]} <span>· {row[2]}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/* ---- the route form ------------------------------------------------------ */
function RouteForm({ date, setDate, todayISO, onSubmitRecord, prefill }) {
  const [list, setList] = useS(null);
  const [from, setFrom] = useS(null);
  const [to, setTo] = useS(null);
  const [depTime, setDepTime] = useS('');
  const [arrTime, setArrTime] = useS('');
  const [err, setErr] = useS(null);
  useE(() => {
    let on = true;
    loadAirports().then((l) => {
      if (!on) return;
      setList(l);
      // ?from=&to= deep link (route pages CTA): resolve exact IATA codes once
      if (prefill) {
        const exact = (code) => {
          const row = searchAirports(l, code, 1)[0];
          return row && row[0] === code ? airportFromRow(row) : null;
        };
        const f = exact(prefill.from), t = exact(prefill.to);
        if (f) setFrom(f);
        if (t) setTo(t);
      }
    });
    return () => { on = false; };
  }, []);

  // live duration preview — the safety net for a wrong-day arrival
  let durLine = null;
  if (from && to && depTime && arrTime && date) {
    const rec = routeRecord({ from, to, dateISO: date, depTime, arrTime });
    const min = Math.round((Date.parse(rec.arrUTC) - Date.parse(rec.depUTC)) / 60000);
    const nextDay = rec.arrUTC.slice(0, 10) !== rec.depUTC.slice(0, 10);
    durLine = `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m flight` +
              (nextDay ? ' · lands the next day' : '') +
              (rec.durationWarn ? ' — over 20 hours, check the arrival time' : '');
  }

  function submit(e) {
    e.preventDefault();
    if (!from || !to) { setErr('Pick both airports from the list.'); return; }
    if (from.iata === to.iata) { setErr('Departure and arrival are the same airport.'); return; }
    if (!depTime || !arrTime) { setErr('Enter the departure and arrival times from your itinerary.'); return; }
    setErr(null);
    onSubmitRecord(routeRecord({ from, to, dateISO: date, depTime, arrTime }));
  }

  return (
    <form className="form" onSubmit={submit}>
      <AirportField id="rt-from" label="From" placeholder="City or airport — London, LHR…"
                    list={list} value={from} onPick={setFrom} />
      <AirportField id="rt-to" label="To" placeholder="City or airport — Jeddah, JED…"
                    list={list} value={to} onPick={setTo} />
      <div className="route-times">
        <div className="field">
          <label htmlFor="rt-dep">Departs <em>local</em></label>
          <input id="rt-dep" className="input compact" type="time" value={depTime}
                 onChange={(e) => setDepTime(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="rt-arr">Arrives <em>local</em></label>
          <input id="rt-arr" className="input compact" type="time" value={arrTime}
                 onChange={(e) => setArrTime(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <div className="label-row">
          <label htmlFor="rt-date">Date of departure</label>
          {date !== todayISO() ? (
            <button type="button" className="today-btn" onClick={() => setDate(todayISO())}>Today</button>
          ) : null}
        </div>
        <input id="rt-date" className="input compact" type="date" value={date}
               onChange={(e) => setDate(e.target.value)} />
      </div>
      {durLine ? <div className="duration-line">{durLine}</div> : null}
      {err ? <div className="field-error"><Ic.alert style={{ width: 15, height: 15 }} aria-hidden="true" />{err}</div> : null}
      <button className="btn" type="submit">
        Find my prayer times <Ic.arrow aria-hidden="true" />
      </button>
      <div className="offline-note"><Ic.plane aria-hidden="true" /> All on your device — route lookups work offline</div>
    </form>
  );
}

export { RouteForm };
