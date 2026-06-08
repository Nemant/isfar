/* ===========================================================================
   Isfar — ArcTimeline: the sun's path across the journey
   x  = every prayer the flight crosses, evenly spaced in order (5 — or more,
        with repeats, on ultra-long eastbound routes that sweep >24h of sun)
   y  = the sun's elevation at that prayer's time of day: dawn & dusk on the
        horizon, midday high, night below the horizon line
   dot = filled when prayed ALOFT, hollow when prayed ON THE GROUND
   colour = the sun-arc palette (Fajr violet → Dhuhr gold → Maghrib orange …)
   =========================================================================== */

function ArcTimeline({ f, activeKey, onSelect }) {
  const n = f.prayers.length;
  const originIata = f.from.iata;
  const dateOf = (pr) => (pr.zones[originIata] || Object.values(pr.zones)[0]).date;
  const padX = 30, midY = 120, amp = 80, H = 226;
  const W = Math.max(360, padX * 2 + n * 62);   // widen so many labels still fit
  const innerW = W - 2 * padX;
  const slot = innerW / n;
  const xAt = (i) => padX + (i + 0.5) * slot;
  const elev = (frac) => Math.sin((frac - 0.25) * 2 * Math.PI);
  const yAt = (frac) => midY - elev(frac) * amp;

  const pts = f.prayers.map((pr, i) => ({ pr, x: xAt(i), y: yAt(pr.t), i }));

  // smooth sun curve through the dots, anchored at the horizon on both edges
  const curve = [{ x: 6, y: midY }, ...pts.map(p => ({ x: p.x, y: p.y })), { x: W - 6, y: midY }];
  function smooth(P) {
    let d = `M ${P[0].x.toFixed(1)} ${P[0].y.toFixed(1)}`;
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2;
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  }
  const dPath = smooth(curve);

  // in-flight band (spans the aloft prayers)
  const flightIdx = pts.filter(p => p.pr.status === "inflight").map(p => p.i);
  const band = flightIdx.length
    ? { x1: xAt(Math.min(...flightIdx)) - slot / 2, x2: xAt(Math.max(...flightIdx)) + slot / 2 }
    : null;

  // day-break dividers (where the calendar date changes between prayers)
  const breaks = [];
  for (let i = 1; i < pts.length; i++) {
    if (dateOf(pts[i].pr) !== dateOf(pts[i - 1].pr)) {
      breaks.push({ x: (pts[i].x + pts[i - 1].x) / 2, label: dateOf(pts[i].pr) });
    }
  }
  const multiDay = new Set(pts.map(p => dateOf(p.pr))).size > 1;

  const dotColor = (k) => window.ISFAR_DATA.COLOR[k];
  const ORD = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th" };

  // zig-zag label sides so adjacent labels never overlap
  let prevSide = "below";
  const sideFor = (p) => {
    let side = p.y < 60 ? "below" : p.y > midY + 20 ? "above" : (prevSide === "above" ? "below" : "above");
    prevSide = side;
    return side;
  };

  return (
    <section className="arc-card" aria-label="The sun's path and your prayers across the flight">
      <div className="arc-title">
        <h2>Across your flight</h2>
        <span className="ref">
          {multiDay ? `${n} prayers · 2 days` : `${n} prayers · ${f.from.iata}→${f.to.iata}`}
        </span>
      </div>
      <svg className="arc-svg" viewBox={`0 0 ${W} ${H}`} role="img"
           aria-label={`${n} prayers from ${f.from.city} to ${f.to.city}, placed by the sun's height: dawn and dusk low, midday high, night below the horizon.`}>
        {/* in-flight band */}
        {band && (
          <g>
            <rect x={band.x1} y="6" width={band.x2 - band.x1} height={H - 40} rx="12"
                  fill="oklch(from var(--accent) l c h / 0.07)" stroke="oklch(from var(--accent) l c h / 0.18)" strokeWidth="1" strokeDasharray="3 4" />
            <text x={(band.x1 + band.x2) / 2} y="20" textAnchor="middle"
                  fontSize="9" fontWeight="700" letterSpacing="0.5"
                  fill="var(--accent)" opacity="0.85">✈  IN FLIGHT</text>
          </g>
        )}

        {/* day-break dividers */}
        {breaks.map((b, i) => (
          <g key={"brk" + i}>
            <line x1={b.x} y1="30" x2={b.x} y2={H - 30} stroke="var(--text-mute)" strokeWidth="1" strokeDasharray="2 4" opacity="0.5" />
            <text x={b.x + 4} y="40" fontSize="8.5" fontWeight="600" fill="var(--text-mute)">{b.label}</text>
          </g>
        ))}

        {/* horizon */}
        <line className="arc-horizon" x1="6" y1={midY} x2={W - 6} y2={midY} />
        <text x="8" y={midY - 4} textAnchor="start" fontSize="8" fill="var(--text-mute)" opacity="0.6">horizon</text>

        {/* the sun curve */}
        <path className="arc-base" d={dPath} />

        {/* prayer suns */}
        {pts.map((p) => {
          const pr = p.pr, c = dotColor(pr.key);
          const active = activeKey === pr.id;
          const aloft = pr.status === "inflight";
          const side = sideFor(p);
          const nameY = side === "above" ? p.y - 16 : p.y + 24;
          const tip   = side === "above" ? p.y - 13 : p.y + 13;
          return (
            <g key={pr.id} className={"prayer-dot" + (active ? " active" : "")}
               onClick={() => onSelect && onSelect(pr.id)} role="button" tabIndex={0}
               onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect && onSelect(pr.id); } }}
               aria-label={`${pr.en}, ${aloft ? "in flight" : pr.status === "before" ? "before departure" : "after arrival"}`}>
              <line x1={p.x} y1={p.y} x2={p.x} y2={tip} stroke={c} strokeWidth="1" opacity="0.35" />
              <circle className="halo" cx={p.x} cy={p.y} r={active ? 16 : 12}
                      fill={`oklch(from ${c} l c h / 0.26)`} />
              {aloft
                ? <circle className="core" cx={p.x} cy={p.y} r="6" fill={c} />
                : <circle className="core-hollow" cx={p.x} cy={p.y} r="5.5" fill="var(--bg-mid)" stroke={c} strokeWidth="2.5" />}
              <text className="lbl" x={p.x} y={nameY} textAnchor="middle">
                {pr.en}
              </text>
            </g>
          );
        })}
      </svg>

      {/* legend */}
      <div className="arc-legend">
        <div className="lg"><i className="dot-filled"></i> prayed aloft</div>
        <div className="lg"><i className="dot-hollow"></i> on the ground</div>
        <div className="lg"><i className="dot-band"></i> flight window</div>
      </div>
    </section>
  );
}

window.ArcTimeline = ArcTimeline;
