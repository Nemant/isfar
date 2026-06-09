# Praying by a sun that won't set

*How Isfar finds prayer times where the night disappears — and why we round the far north down to 60°.*

> **Status:** PUBLISHED 2026-06-09 — live at `https://isfar.app/guide/far-north-prayer-times/`
> (source: `src/pages/guide/far-north-prayer-times.astro`, with all six wishlist animations as
> `src/components/blog/Anim*.astro`). **The page is the canonical copy** — it carries the full
> review pass (line edits, taqdīr paragraph, FAQ block, internal links). This file keeps the
> narrative draft + production notes; the factual corrections below have been mirrored here so
> nothing in this file is quotably wrong.
> **Credit:** the latitude-and-season framing that anchors our approach is owed to
> [moonsighting.com's "How we calculate"](https://moonsighting.com/how-we.html) by Khalid Shaukat.
> All times in this post are computed with [adhan-js](https://github.com/batoulapps/adhan-js),
> the same library Isfar uses — nothing here is hand-calculated.

---

## A flight with a hole in it

This feature began with a bug report that wasn't a bug. A traveller looked up **BA48, Seattle to
London** — an overnight hop across the high Atlantic in June — and the app showed Maghrib, and
then… Dhuhr. No Isha. No Fajr. Two prayers had simply fallen out of the sky.

The app wasn't broken. The sky was. For a few midsummer weeks, along the top of that route, the
sun never gets far enough below the horizon for Isha or Fajr to *exist* — at least not by the
rules most prayer apps use. The calculation didn't fail loudly; it returned nothing, and the
nothing looked like an answer.

Fixing that properly took us through some beautiful astronomy, several scholarly opinions, and a
string of edge cases that each broke a different way. This post walks the same road, slowly. By
the end you'll know exactly what Isfar does on a far-north flight, and why.

One thing this post is **not**: a fiqh ruling. The juristic groundwork here was laid by scholars,
and the disagreements between them are theirs to hold. Our job was narrower — take the recognized
opinions and make them *work inside an app*, honestly, for an ordinary traveller. Where we had to
choose, we chose for clarity and marked the result as an estimate. Follow your own scholars and
community where you land.

## Five prayers, five positions of the sun

Prayer times aren't arbitrary clock times. Each one is pinned to something the sun does:

| Prayer | The sun's moment |
|---|---|
| **Fajr** | First light of dawn — the sky begins to glow while the sun is still well below the horizon |
| **Dhuhr** | Just past solar noon — the sun crests your meridian and begins to lean west |
| **Asr** | Mid-afternoon — when a shadow reaches a set proportion of its object |
| **Maghrib** | Sunset — the sun's disk slips below the horizon |
| **Isha** | Nightfall — the last twilight fades and the sky is truly dark |

Three of these are sturdy. Solar noon happens every day, everywhere. Sunset and the shadow-lengths
of afternoon exist anywhere the sun rises at all. But Fajr and Isha are different — they don't
mark the sun's *disk*, they mark its *light*.

## Dawn and dusk are angles

How do you put a number on "first light" or "true dark"? Astronomers — and the fiqh councils —
answer with an **angle**: how far the sun sits *below* the horizon. At sunset the sun is at 0°.
As it keeps sinking, twilight fades. Somewhere between **12° and 18° below the horizon**, the
glow dies and the stars take the sky.

The world's calculation authorities each fixed their own number from long observation: the Muslim
World League uses **18°** for Fajr, ISNA (North America) uses **15°**, Egypt's authority **19.5°**,
and so on. This is why two apps can disagree by half an hour — they're loyal to different
authorities, not different math. Isfar lets you pick yours in Settings and computes it faithfully.

At most latitudes, that's the whole story. In Istanbul or New York, the sun dives deep below the
horizon every single night of the year, sails past 15°, past 18°, and the angles always have a
moment to mark. The method you choose just works.

Then you fly north.

## What latitude does to the night

The Earth is tilted about 23.4°. In northern summer, the top of the planet leans *toward* the sun
— so the further north you stand, the shallower the sun's dip below your horizon at midnight. It
sets, but it doesn't go *down* very far. It grazes along just under the horizon, and the twilight
never quite dies.

Watch what happens to a June night as you move north, using real computed times:

**London (51.5°N), June 21, with a 15° method.** It still works — barely. True dark arrives at
**00:49** and first light returns at **01:16**. Isha and Fajr both exist, separated by a window of
twenty-seven minutes.

**London, same night, with an 18° method.** The sun never reaches 18° below the horizon at all.
Ask the math anyway and Fajr and Isha both land on **01:02 — the same minute**. The angle a
traveller chose in good faith has, for a few weeks of the year, stopped describing anything real.

**Stockholm (59.3°N), June 21.** Now even 15° is unreachable. The night between sunset (22:08
local) and sunrise (03:31) never gets properly dark at all. There is simply no instant of "true
dark" to point to.

And it keeps going. Cross the Arctic Circle (66.5°N) and in midsummer the sun stops *setting*
altogether — the midnight sun. In Tromsø, Norway, it stays above the horizon from mid-May to late
July. No sunset means no Maghrib moment, no night, no dawn. Three of the five prayers have lost
their sun-marks; only the noon and afternoon prayers still have a sky to point at.

## The scholarly toolkit — and where each tool breaks

None of this is new. Scholars have written about prayer at extreme latitudes for centuries, and
several practical conventions are in wide use. We tried each of them in software, honestly, and
each one breaks somewhere specific. (Details of the juristic reasoning belong to the scholars;
what follows is engineering.)

**Use the chosen angle, always.** Breaks first. As London-in-June showed, an 18° angle stops
existing at ~48°N in midsummer, 15° at ~52°N. You cannot compute a time from an angle the sun
never reaches.

**Middle of the night.** When the angle fails, treat the night's midpoint as a boundary — Isha
must arrive by it, Fajr won't begin before it. Simple — but at exactly the latitudes that need
the rule, both times get pinned to that same instant. Stockholm, June 21: Fajr **00:50**, Isha
**00:50** — the same minute, in the small hours. This is the silent default in much prayer
software, and it's why far-north timetables so often collapse into a single strange minute.

**A seventh of the night** (*subʿ al-layl* — the convention moonsighting.com favors for these
latitudes). Divide the actual night, sunset to sunrise, into sevenths: Isha falls after the first
seventh, Fajr begins at the last. At Stockholm in June this produces a humane, prayable schedule:
Maghrib 22:08, **Isha 22:54**, **Fajr 02:45**, sunrise 03:31. It uses *your own* sky, scales with
the seasons, and degrades gracefully… as long as there *is* a night to divide.

**Which is the catch.** Cross the Arctic Circle in summer and the night is gone — a seventh of
nothing is nothing. And just *below* the circle the night can be twenty minutes long, so
Maghrib, Isha, Fajr and sunrise all crowd into a sliver, minutes apart.

**The nearest place with a valid time** (*aqrab al-bilād*). When your own sky fails, borrow from
the closest latitude where the calculation still works. Sound idea — but implemented literally,
software slides to the *mathematical boundary*: the exact latitude where the night is a
fifteen-minute sliver. The borrowed times sit right at the breaking point and lurch from day to
day as that boundary moves.

Every tool is good. Every tool has a cliff. The design question was never "which opinion is
correct" — it was *where to stand* so the cliffs don't reach the user.

## Why we round down to 60°

The answer Isfar settled on: when a calculation has nowhere real to stand, compute it as if you
were at **latitude 60°N** (at your own longitude). Not the nearest valid latitude — a fixed,
deliberate floor. Two reasons, and they point at the same line on the map.

**The astronomical reason.** 60° is about the furthest north that keeps a dependable night all
year round. Its midsummer night is short but real — just over five hours, enough for the
seventh-of-the-night convention to produce sensible, stable, *prayable* times every single day of
the year. Go higher and the guarantee dissolves; stop at 60° and the borrowed night never gets
more extreme than Helsinki's.

**The human reason.** 60°N is, in practice, where the world's big cities stop. Look at who lives
on that line:

| City | Latitude | Metro population | Muslim community (rough estimate) |
|---|---|---|---|
| Stockholm | 59.3°N | ~2.4M | ~150–250k — among Europe's larger shares |
| Oslo | 59.9°N | ~1.6M | ~100–150k — Norway's largest Muslim community |
| St Petersburg | 59.9°N | ~5.6M | low hundreds of thousands incl. Central Asian communities; a historic grand mosque |
| Helsinki | 60.2°N | ~1.5M | ~80–100k, incl. a Tatar community over a century old |
| Anchorage | 61.2°N | ~0.4M | a few thousand — Alaska's main congregation |

*(Population figures are metro-area approximations; Muslim community sizes are order-of-magnitude
estimates assembled from national statistics and community sources — treat them as such.)*

Five cities, strung within a degree or two of the line, each with an established Muslim community
that faces these skies every June — and almost nothing million-scale beyond them. (Mid-size
cities do exist further north — Murmansk, Arkhangelsk, Yakutsk — but nothing on the scale of
this cluster.) Anchoring the fallback at 60° means the borrowed times are
the *lived* times of Stockholm, Oslo, St Petersburg and Helsinki — not an abstract sliver-night at
a mathematical boundary. And for the traveller who does continue to Tromsø, where the world's
northernmost mosques actually hold these debates as a matter of daily life, the estimate they
receive is anchored to the nearest great cities to their south.

## Summer breaks the night. Winter breaks the day.

Here's the part that surprised us during testing: **this is a two-season problem, and the seasons
break different prayers.**

Summer is the night-killer. Below the Arctic Circle, the *days* are long but normal — the sun
rises and sets — so Dhuhr, Asr and Maghrib are all real. It's the twilight prayers, Fajr and Isha,
that fail first, starting around 48–55°N depending on your angle. Cross the circle and Maghrib
finally goes too.

Winter is the opposite — and gentler, for longer. A short, dark December day at Stockholm or
Helsinki is *perfect* for prayer times: the sun rises, sets, and plunges deep below the horizon.
Every angle works. **At 55–60°N, winter is the easy season.** The methods that strained all summer
relax completely.

But cross the Arctic Circle in winter and the failure inverts. Now the sun never *rises* — polar
night. Maghrib, Isha and Fajr have no sunset or twilight to hang on. **Asr breaks too**, for a
reason we found oddly poignant: Asr is defined by the length of a shadow, and a sun that never
rises casts none. Even Dhuhr — solar "noon" — happens with the sun below the horizon; the moment
exists, but it isn't *midday* in any visible sense.

So the full picture, for Tromsø across one year, prayer by prayer:

| | Fajr | Dhuhr | Asr | Maghrib | Isha |
|---|---|---|---|---|---|
| **March / October** | real | real | real | real | real |
| **June (midnight sun)** | estimated | real | real | estimated | estimated |
| **December (polar night)** | estimated | estimated* | estimated | estimated | estimated |

*\*Dhuhr's solar-noon instant is always defined — in polar night we keep its exact time but flag
it, because calling it "midday" when the sun never rose would overstate what we know.*

Note the first row. For four to five months of the year, depending on your angle — late winter
into spring, and again through autumn — even Tromsø, 350 km past the Arctic Circle, has
perfectly ordinary prayer times, and Isfar computes them with your chosen method, no fallbacks,
no estimates. The machinery below only wakes when the sky stops offering its usual signs.

## What Isfar actually does

All of the above condenses to three rules, applied automatically, **per prayer, per date, per
position along your flight path**:

1. **Wherever the sun reaches your method's angle — use it.** Your chosen authority's real times,
   untouched. This covers almost every flight, and even the far north for most of the year.
2. **Where the angle is out of reach, up to 60° — divide your own night by sevenths.** Your
   local night, sunset to sunrise, portioned following the old juristic convention
   moonsighting.com recommends. The result is marked as an estimate.
3. **Beyond 60°, or where no night survives at all — compute at 60°N**, your longitude, as if
   you stood there: your method's real angle wherever that borrowed sky reaches it, never
   straying more than a seventh of the borrowed night from its sunset or sunrise. Marked as an
   estimate, with a banner telling you why ("the sun won't set at Tromsø tonight…").

The switch between rule 1 and rule 2 isn't a line of latitude — it's *your angle meeting your
sky*. Choose an 18° method and the fallback engages further south than your neighbour's 15°;
in winter it disengages entirely. The app adapts to the opinion you follow rather than overriding
it.

And everything estimated *says so*. A `~` before the time, an "estimate" tag on the card, and a
plain-language note. We'd rather show you an honest approximation than a confident fiction —
that's the same reason the app errs late on Maghrib at altitude and tells you the sun it
calculates from is the one outside your window.

A worked example, the day we kept testing: **Oslo → Tromsø, December 21st**, landing in polar
night. Before departure, Oslo's real Asr (13:04) and Maghrib (15:08). Isha arrives mid-flight,
where the night below the aircraft is still real. After landing: Fajr ~06:25, borrowed from
latitude 60° — where a 15° dawn still exists even in late December — and Dhuhr ~11:43, Tromsø's
own solar noon, flagged because the sun beneath it never rises. Both carry the `~`, under a
banner that says the sun will not rise tomorrow in Tromsø, and that's why.

## Standing on others' work

The shape of this solution — *use the real angle while it exists, portion the night where it
doesn't, and slide to a humane reference latitude rather than a mathematical edge* — follows the
framework laid out by Khalid Shaukat at
**[moonsighting.com](https://moonsighting.com/how-we.html)**, whose latitude-and-season treatment
of Subh Sadiq and Shafaq has quietly anchored sensible high-latitude timetables for years. The
celestial mechanics are [adhan-js](https://github.com/batoulapps/adhan-js), the open-source
library trusted across the Muslim app ecosystem; Isfar chooses *which question to ask it*, and
never computes a prayer time by hand.

And the deeper debt is to the scholars — classical and contemporary — who took "what do we do
when the sun won't set?" seriously enough to leave the rest of us several good answers. We didn't
adjudicate between them, and won't. We built a traveller's instrument that uses their work
honestly, labels its approximations, and gets out of the way.

Safe travels. *سفر مبارك*

---
---

## Production notes (not for publication)

### Numbers — provenance
Every time quoted above was re-verified with adhan-js 4.4.3 at publication (2026-06-09) via
`scripts/verify-blog-times.mjs` (run it any time). London June: 15° → Isha 00:49/Fajr 01:16 BST
(27-min window); 18° → both 01:02 BST = 00:02 UTC (collapsed). Stockholm June:
MiddleOfTheNight → both 22:50 UTC, half a second apart (collapsed); SeventhOfTheNight → Isha
20:54/Fajr 00:45 UTC. Tromsø Dec borrowed-60: Fajr 06:25 / Maghrib 14:38 / Isha 16:59 CET
(these are the real 15° angle times at lat 60 — the seventh clamp doesn't bind in winter).
Tromsø midnight sun ≈ May 18 – Jul 25; polar night ≈ Nov 28 – Jan 15. Tromsø has all-five-real
days only ~41% of the year with a 15° method (engine classification) — hence "four to five
months". BA48 now renders: Maghrib real, Isha ~portioned, Fajr ~substituted, 2nd Dhuhr real.

City-table figures are deliberately hedged (metro approximations; community estimates from
national statistics + community sources). Before publishing, decide whether to cite specific
sources per row or keep the "rough estimate" framing with the italic disclaimer.

### Animation / illustration wishlist (calm theme: light, horizon, sky — no clip-art)
1. **The tilted Earth** — slow rotation, 23.4° tilt visible, terminator (day/night line) sweeping;
   seasons toggle (Jun/Dec) shows the polar cap staying lit / staying dark. Sets up everything.
2. **The angle, drawn** — a flat horizon, the sun sliding below it, with the depression angle
   (0° → 15° → 18°) drawn as a thin arc; twilight glow fading in sync. One diagram kills a
   thousand words of "what is a twilight angle."
3. **The shrinking dip** — side-by-side midnight sun-paths at 40° / 52° / 60° / 70°N in June: the
   sun's arc flattening until it never goes below 15°, then never below 0°. The whole story in
   one motion.
4. **The collapsing night** — a 24h dial for Stockholm June: sunset and sunrise creeping toward
   each other, the Isha/Fajr markers from each rule (angle → gone; midnight → overlapping; 1/7 →
   sane) appearing on the dial. Shows *where each opinion breaks* visually.
5. **The 60° floor** — a globe/map zoom along the 60th parallel touching Stockholm, Oslo,
   St Petersburg, Helsinki, Anchorage; then Tromsø further north with a thin line dropping its
   times down to the 60° parallel. The "round down" made visible.
6. **Two seasons, two failures** — Tromsø year wheel: midnight-sun arc (summer) vs polar-night
   arc (winter), with the five prayer dots lighting up real/estimated per season (the table,
   animated).
7. Reuse the app's sun-arc visual language (the `ArcTimeline` curve, oklch sky palette,
   dashed-border estimate styling) so the post and the app feel like one object.

### Publication checklist
- [x] Phase D content hub exists — `/guide/far-north-prayer-times/` (`src/pages/guide/…`)
- [x] Re-verify all quoted times against the current engine (`scripts/verify-blog-times.mjs`;
      several were corrected — see provenance above)
- [x] Decide citation depth for the city table — kept the "rough estimate" framing with the
      italic disclaimer; texture moved from cells into prose
- [x] Built ALL SIX animations (`src/components/blog/Anim*.astro`)
- [x] Internal links: "How Isfar works" sheet → guide; midnight-sun banner → guide; guide →
      app (Settings anchor + DY394 CTA)
- [ ] hreflang/i18n pass once translations exist (Phase D)
- [ ] Optional: dedicated OG image cut from the shrinking-dip figure (currently reuses og-cover)
