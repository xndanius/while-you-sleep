export { TIMEZONE,HOURS,PUBLICATION_MINUTE,RESEARCH_EVERY_HOURS,RESEARCH_MINUTE,MEASUREMENT_TIME,IMPROVEMENT_TIME,DIGEST_TIME,localParts,nextLocalTime,previousLocalTime,publicationSlots,schedule,dueJobs } from '../public/schedule.js';
export const INITIAL_RULES = Object.freeze({
  id: 'v1', createdAt: '2026-10-10T05:40:00.000Z',
  reason: 'Initial evidence-first rules from the While You Sleep brief.',
  picking: 'Prefer a working product with first-party evidence. Score evidence, novelty, a two-week student MVP, and autonomy from 0 to 5 each. Never treat marketing claims as verified users or revenue. Reject unsafe, speculative, duplicate, or unsupported ideas.',
  writing: 'Use plain English for beginners. Explain what it is, a plausible customer (label as a hypothesis unless verified), a concrete input-to-output loop, exact evidence and its limits, and three achievable first-24-hours steps. Distinguish a real example from a proposed small version. Keep the title under 55 characters and promise under 100 characters. No hype or invented metrics.',
});

export function env(name) {
  return process.env[name];
}
