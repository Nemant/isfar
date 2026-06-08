/* ===========================================================================
   Isfar — prayer cards, status tags, traveller guidance
   =========================================================================== */
const { useRef: useRefCards } = React;

const STATUS_LABEL = {
  before:   { cls: "before",   text: "Before departure" },
  inflight: { cls: "inflight", text: "In flight" },
  after:    { cls: "after",    text: "After arrival" }
};

const ORD = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th" };

function PrayerCard({ pr, active, multiDay, order, refEl }) {
  const Glyph = window.PRAYER_GLYPH[pr.key] || window.Ic.sun;
  const color = window.ISFAR_DATA.COLOR[pr.key];
  const zs = order.map((iata) => pr.zones[iata]).filter(Boolean);
  return (
    <article ref={refEl} className={"prayer-card" + (active ? " active" : "")} style={{ "--dot": color }}
             aria-label={`${pr.en}${pr.qiblaClock ? ", qibla at " + pr.qiblaClock + " o'clock" : ""} — ${zs.map(z => z.iata + " " + z.time).join(", ")}`}>
      <div className="pc-icon"><Glyph aria-hidden="true" /></div>
      <div className="pc-main">
        <div className="pc-name">
          <span className="en">{pr.en}</span>
          <span className="ar" aria-hidden="true">{pr.ar}</span>
        </div>
        {(pr.qiblaClock || pr.sunrise) ? (
          <div className="pc-meta">
            {pr.qiblaClock ? (
              <span className="pc-qibla" title={`Qibla at your ${pr.qiblaClock} o'clock, relative to the direction of travel`}>
                <window.PlaneQibla rel={pr.qiblaRel} color={color} />
                Qibla
              </span>
            ) : null}
            {pr.sunrise ? (
              <span className="pc-sunrise" title="Fajr ends at sunrise">
                <window.Ic.sunrise aria-hidden="true" />
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
            <div className="pc-zone-time tnum">{z.time}</div>
            {multiDay ? <div className="pc-zone-date">{z.date}</div> : null}
          </div>
        ))}
      </div>
    </article>
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
          </div>
        );
      })}
    </section>
  );
}

/* ---- Traveller guidance (collapsible) ---------------------------------- */
function Guidance() {
  const G = window.ISFAR_DATA.GUIDANCE;
  return (
    <details className="guidance">
      <summary className="g-head">
        <span className="g-ic"><window.Ic.book aria-hidden="true" /></span>
        <span className="g-tt">
          <b>Travelling lightly</b>
          <span>Qasr &amp; jam' — concessions for the journey</span>
        </span>
        <span className="chev"><window.Ic.chev aria-hidden="true" /></span>
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
          <window.Ic.info aria-hidden="true" />
          <span>Rulings vary between schools of fiqh and circumstances. This is general guidance — follow your own madhhab or a trusted scholar where you have doubt.</span>
        </div>
      </div>
    </details>
  );
}

window.PrayerList = PrayerList;
window.Guidance = Guidance;
