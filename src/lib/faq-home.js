/* The homepage FAQ — single source for BOTH the visible <details> section and
   the FAQPage JSON-LD in index.astro. Google requires marked-up FAQ content to
   be visible on the page; rendering and markup from one array keeps that true
   by construction. */
export const HOME_FAQ = [
  { q: 'Can you pray on an airplane?',
    a: 'Yes. The majority of scholars hold that a Muslim must pray on the aircraft if the prayer time passes during the flight and there is no prospect of landing in time. You pray as best you can — standing if space allows, otherwise seated — facing the qibla if possible, or at least the general direction. Isfar shows which prayers fall before departure, during the flight, and after arrival so you can plan ahead.' },
  { q: 'What is qasr (shortening prayers) when travelling?',
    a: "Qasr means shortening the four-unit (rak'ah) prayers — Dhuhr, Asr, and Isha — to two units while travelling. It is established in the Quran and Sunnah and is agreed upon across the major legal schools, though they differ on the minimum travel distance that triggers it and on whether it is obligatory or merely permitted. Consult a scholar familiar with your madhhab for personal rulings." },
  { q: "What is jam' (combining prayers) when travelling?",
    a: "Jam' means combining Dhuhr with Asr (praying both together) and Maghrib with Isha (praying both together). This is permitted during travel according to the Hanbali, Shafi'i, and Maliki schools; the Hanafi school generally does not permit combining except at Arafah and Muzdalifah. Isfar highlights which prayers fall in the air so you can decide, with your scholar's guidance, whether to combine or keep them separate." },
  { q: 'How do I face the qibla on a plane?',
    a: "Isfar calculates the qibla bearing from your aircraft's position at each prayer time and expresses it as a clock position relative to the nose — for example, '3 o'clock' means face right. Because the aircraft turns and the position changes throughout the flight, the qibla direction at prayer time is shown individually for each prayer. Most scholars hold that a traveller who cannot determine or maintain the exact direction should face as close to it as they can; standing prayer is preferred if there is space and stability." },
  { q: 'When does Maghrib begin at altitude?',
    a: 'At cruising altitude the horizon is lower than at sea level, so the sun appears to set a few minutes later than it would on the ground. Isfar applies a horizon-dip correction based on altitude so the in-flight Maghrib time is slightly later — erring on the side of caution. Similarly, the end of Fajr (the Fajr-ending sunrise) is calculated a little earlier at altitude. These are modest adjustments of a few minutes at typical cruise levels.' },
  { q: 'Which prayer-time calculation method should I use?',
    a: 'Isfar offers the same calculation methods as adhan.js — including Muslim World League, ISNA, Egyptian General Authority, Umm Al-Qura (used for Saudi Arabia), and others. The right choice depends on the convention used by your community or country of origin. If you are unsure, the Muslim World League method is widely accepted globally, and Umm Al-Qura is standard for travellers departing from or arriving into Saudi Arabia.' },
];
