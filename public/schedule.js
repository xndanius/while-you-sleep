// Shared by the hosted jobs and browser so future times never depend on a build timestamp.
export const TIMEZONE = 'Europe/Vilnius';
export const HOURS = Object.freeze([8, 13, 19]);
export const PUBLICATION_MINUTE = 7;
export const RESEARCH_EVERY_HOURS = 3;
export const RESEARCH_MINUTE = 23;
export const MEASUREMENT_TIME = '21:37';
export const IMPROVEMENT_TIME = '22:13';
export const DIGEST_TIME = '08:17';
const formatter = new Intl.DateTimeFormat('en-CA', {timeZone:TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'});
const instant = value => value instanceof Date ? value : new Date(value);
const pad = value => String(value).padStart(2, '0');
const valid = value => Number.isFinite(instant(value).getTime());

export function localParts(date = new Date()) {
  const p = Object.fromEntries(formatter.formatToParts(instant(date)).map(part => [part.type,part.value]));
  return {day:`${p.year}-${p.month}-${p.day}`,hour:Number(p.hour),minute:Number(p.minute),weekday:p.weekday};
}

export function nextLocalTime(predicate, date = new Date()) {
  const start = Math.floor(instant(date).getTime()/60000)*60000+60000;
  for(let time=start; time<start+8*86400000; time+=60000) if(predicate(localParts(new Date(time)))) return new Date(time).toISOString();
  return null;
}

export function previousLocalTime(predicate, date = new Date()) {
  const start = Math.floor(instant(date).getTime()/60000)*60000;
  for(let time=start; time>start-8*86400000; time-=60000) if(predicate(localParts(new Date(time)))) return new Date(time).toISOString();
  return null;
}

export function publicationSlots(date = new Date()) {
  const {day} = localParts(date), [year,month,dayOfMonth] = day.split('-').map(Number);
  const start = Date.UTC(year,month-1,dayOfMonth)-4*3600000, slots=[];
  for(let time=start;time<start+30*3600000;time+=60000) {
    const p=localParts(new Date(time));
    if(p.day===day && HOURS.includes(p.hour) && p.minute===PUBLICATION_MINUTE) {
      const localTime=`${pad(p.hour)}:${pad(p.minute)}`;
      slots.push({id:`publish-${day}-${pad(p.hour)}-${pad(p.minute)}`,scheduledAt:new Date(time).toISOString(),localDate:day,localTime});
    }
  }
  return slots;
}

export function schedule(date = new Date()) {
  return {
    timezone:TIMEZONE,publicationHours:HOURS,publicationMinute:PUBLICATION_MINUTE,
    publicationTimes:HOURS.map(hour=>`${pad(hour)}:${pad(PUBLICATION_MINUTE)}`),publicationSlots:publicationSlots(date),
    researchEveryHours:RESEARCH_EVERY_HOURS,researchMinute:RESEARCH_MINUTE,
    hosted:true,engine:'GitHub Actions + official openai/codex-action',measurementTime:MEASUREMENT_TIME,improvementTime:IMPROVEMENT_TIME,weeklyDigestTime:'Monday 08:17',
    nextPublicationAt:nextLocalTime(p=>HOURS.includes(p.hour)&&p.minute===PUBLICATION_MINUTE,date),
    previousPublicationAt:previousLocalTime(p=>HOURS.includes(p.hour)&&p.minute===PUBLICATION_MINUTE,date),
    nextResearchAt:nextLocalTime(p=>p.hour%RESEARCH_EVERY_HOURS===0&&p.minute===RESEARCH_MINUTE,date),
    nextMeasurementAt:nextLocalTime(p=>p.hour===21&&p.minute===37,date),
    nextImprovementAt:nextLocalTime(p=>p.hour===22&&p.minute===13,date),
    nextDigestAt:nextLocalTime(p=>p.weekday==='Mon'&&p.hour===8&&p.minute===17,date),
  };
}

export function dueJobs(date = new Date()) {
  const now=instant(date),p=localParts(now),jobs=[];
  const researchAt=previousLocalTime(part=>part.hour%RESEARCH_EVERY_HOURS===0&&part.minute===RESEARCH_MINUTE,now),research=localParts(researchAt);
  jobs.push({action:'research',jobKey:`research-${research.day}-${pad(research.hour)}-${pad(research.minute)}`,scheduledAt:researchAt});
  for(const slot of publicationSlots(now).filter(slot=>new Date(slot.scheduledAt)<=now)) jobs.push({action:'publish',jobKey:slot.id,scheduledAt:slot.scheduledAt});
  if(p.hour*60+p.minute>=21*60+37) jobs.push({action:'measure',jobKey:`measure-${p.day}-21-37`});
  if(p.hour*60+p.minute>=22*60+13) jobs.push({action:'improve',jobKey:`improve-${p.day}-22-13`});
  if(p.weekday==='Mon'&&p.hour*60+p.minute>=8*60+17) jobs.push({action:'digest',jobKey:`digest-${p.day}`});
  return jobs;
}

export function loopTiming(lastLoopAt, date = new Date()) {
  const cadence=schedule(date),slot=cadence.previousPublicationAt;
  const elapsed=(instant(date).getTime()-new Date(slot).getTime())/60000;
  const recorded=valid(lastLoopAt)&&new Date(lastLoopAt)>=new Date(slot);
  return {...cadence,latestSlotAt:slot,slotState:recorded?'recorded':elapsed<30?'waiting':elapsed<60?'late':'missed'};
}
