export const TIMEZONE = 'Europe/Vilnius';
export const HOURS = [8, 13, 19];
export const INITIAL_RULES = Object.freeze({
  id: 'v1', createdAt: '2026-10-10T05:40:00.000Z',
  reason: 'Initial evidence-first rules from the While You Sleep brief.',
  picking: 'Prefer a working product with first-party evidence. Score evidence, novelty, a two-week student MVP, and autonomy from 0 to 5 each. Never treat marketing claims as verified users or revenue. Reject unsafe, speculative, duplicate, or unsupported ideas.',
  writing: 'Use plain English for beginners. Explain what it is, a plausible customer (label as a hypothesis unless verified), a concrete input-to-output loop, exact evidence and its limits, and three achievable first-24-hours steps. Distinguish a real example from a proposed small version. Keep the title under 55 characters and promise under 100 characters. No hype or invented metrics.',
});

export function env(name) {
  return process.env[name];
}

export function localParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(date);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), weekday: p.weekday };
}

// Searching UTC instants through Intl keeps the advertised local cadence correct
// when Europe/Vilnius changes between summer and winter time.
export function nextLocalTime(predicate, date = new Date()) {
  const start = Math.floor(date.getTime() / 60000) * 60000 + 60000;
  for (let time = start; time < start + 8 * 86400000; time += 60000) {
    const instant = new Date(time);
    if (predicate(localParts(instant))) return instant.toISOString();
  }
  return null;
}

export function schedule(date = new Date()) {
  return {
    timezone: TIMEZONE, publicationHours: HOURS, researchEveryHours: 3,
    hosted: true, engine: 'GitHub Actions + official openai/codex-action', measurementTime:'21:30', improvementTime:'22:00',
    nextPublicationAt: nextLocalTime(p => HOURS.includes(p.hour) && p.minute === 0, date),
    nextResearchAt: nextLocalTime(p => p.hour % 3 === 0 && p.minute === 0, date),
    nextMeasurementAt: nextLocalTime(p => p.hour === 21 && p.minute === 30, date),
    nextImprovementAt: nextLocalTime(p => p.hour === 22 && p.minute === 0, date),
    nextDigestAt: nextLocalTime(p => p.weekday === 'Mon' && p.hour === 8 && p.minute === 0, date),
  };
}

export function dueJobs(date = new Date()) {
  const p = localParts(date);
  const jobs = [];
  // Catch up missed slots on the same day; immutable completions prevent repeats.
  const researchHour = Math.floor(p.hour / 3) * 3;
  jobs.push({ action: 'research', jobKey: `research-${p.day}-${String(researchHour).padStart(2, '0')}` });
  for (const hour of HOURS.filter(h => h <= p.hour)) jobs.push({ action: 'publish', jobKey: `publish-${p.day}-${hour}` });
  if (p.hour >= 22) jobs.push({ action: 'improve', jobKey: `improve-${p.day}` });
  if (p.weekday === 'Mon' && p.hour >= 8) jobs.push({ action: 'digest', jobKey: `digest-${p.day}` });
  return jobs;
}
