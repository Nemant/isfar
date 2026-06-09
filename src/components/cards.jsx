/* ===========================================================================
   Isfar — prayer cards, status tags, traveller guidance
   =========================================================================== */
import React from 'react';
import { COLOR, GUIDANCE } from '../lib/data.js';
import { PRAYER_GLYPH, Ic, PlaneQibla } from './components.jsx';
const { useRef: useRefCards } = React;

const STATUS_LABEL = {
  before:   { cls: "before",   text: "Before departure" },
  inflight: { cls: "inflight", text: "In flight" },
  after:    { cls: "after",    text: "After arrival" }
};

const ORD = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th" };

function PrayerCard({ pr, active, multiDay, order, refEl }) {
  const Glyph = PRAYER_GLYPH[pr.key] || Ic.sun;
  const color = COLOR[pr.key];
  const zs = order.map((iata) => pr.zones[iata]).filter(Boolean);
  return (
    <article ref={refEl} className={"prayer-card" + (active ? " active" : "") + (pr.estimated ? " estimate" : "")} style={{ "--dot": color }}
             aria-label={`${pr.en}${pr.estimated ? " (estimated)" : ""}${pr.qiblaClock ? ", qibla at " + pr.qiblaClock + " o'clock" : ""} — ${zs.map(z => z.iata + " " + z.time).join(", ")}`}>
      <div className="pc-icon"><Glyph aria-hidden="true" /></div>
      <div className="pc-main">
        <div className="pc-name">
          <span className="en">{pr.en}</span>
          <span className="ar" aria-hidden="true">{pr.ar}</span>
          {pr.estimated ? <span className="pc-est-pill">estimate</span> : null}
        </div>
        {(pr.qiblaClock || pr.sunrise) ? (
          <div className="pc-meta">
            {pr.qiblaClock ? (
              <span className="pc-qibla" title={`Qibla at your ${pr.qiblaClock} o'clock, relative to the direction of travel`}>
                <PlaneQibla rel={pr.qiblaRel} color={color} />
                Qibla
              </span>
            ) : null}
            {pr.sunrise ? (
              <span className="pc-sunrise" title="Fajr ends at sunrise">
                <Ic.sunrise aria-hidden="true" />
                Sunrise · {order.map((i) => pr.sunrise[i] && `${i} ${pr.sunrise[i]}`).filter(Boolean).join(" · ")}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="pc-right">
        {zs.map((z) => (
          <div className="pc-zone" key={z.iata}>
            <div className="pc-zone-code">{z.iata}</div>
            <div className="pc-zone-time tnum">{pr.estimated ? "~" : ""}{z.time}</div>
            {multiDay ? <div className="pc-zone-date">{z.date}</div> : null}
          </div>
        ))}
      </div>
    </article>
  );
}

function EstimateNote({ items }) {
  const est = items.filter(p => p.estimated);
  if (!est.length) return null;
  const text = "The far-north summer night is too short — or absent — for the usual twilight angles, so these times are estimated from a settled night at 60°N. Scholars differ; follow the guidance you trust.";
  return (
    <div className="pc-est-note">
      <Ic.info aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

function PrayerList({ f, activeKey, cardRefs }) {
  const order = [f.from.iata, f.to.iata];
  const multiDay = order.some(i => new Set(f.prayers.map(p => (p.zones[i] || {}).date)).size > 1);
  const sections = [
    { status: "before",   label: "Before departure", note: `on the ground in ${f.from.city}` },
    { status: "inflight", label: "In flight",         note: "qibla shown relative to your heading" },
    { status: "after",    label: "After arrival",     note: `on the ground in ${f.to.city}` }
  ];
  return (
    <section className="prayer-list" aria-label="Prayers across your flight">
      {sections.map((sec) => {
        const items = f.prayers.filter((p) => p.status === sec.status);
        if (!items.length) return null;
        return (
          <div className="pc-group" key={sec.status}>
            <div className="pc-section">
              <span className="pc-section-label">{sec.label}</span>
              <span className="pc-section-note">{sec.note}</span>
            </div>
            {items.map((pr) => (
              <PrayerCard key={pr.id} pr={pr} multiDay={multiDay} order={order}
                          active={activeKey === pr.id}
                          refEl={(el) => { if (cardRefs) cardRefs.current[pr.id] = el; }} />
            ))}
            <EstimateNote items={items} />
          </div>
        );
      })}
    </section>
  );
}

/* ---- Traveller guidance (collapsible) ---------------------------------- */
function Guidance() {
  const G = GUIDANCE;
  return (
    <details className="guidance">
      <summary className="g-head">
        <span className="g-ic"><Ic.book aria-hidden="true" /></span>
        <span className="g-tt">
          <b>Travelling lightly</b>
          <span>Qasr &amp; jam' — concessions for the journey</span>
        </span>
        <span className="chev"><Ic.chev aria-hidden="true" /></span>
      </summary>
      <div className="g-body">
        {G.map((g) => (
          <div className="rule" key={g.key}>
            <h4>{g.title} <span className="ar" aria-hidden="true">{g.ar}</span>
              <span style={{fontWeight:500, color:"var(--text-mute)", fontSize:"13px"}}>· {g.label}</span></h4>
            <p>{g.body}</p>
          </div>
        ))}
        <div className="g-note">
          <Ic.info aria-hidden="true" />
          <span>Rulings vary between schools of fiqh and circumstances. This is general guidance — follow your own madhhab or a trusted scholar where you have doubt.</span>
        </div>
      </div>
    </details>
  );
}

export { PrayerList, Guidance };
