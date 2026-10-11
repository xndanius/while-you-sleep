// Frozen scheduling activation metadata: relayConfirmedAt records the approval
// reported at activation. Corrections and actual current readiness are recorded
// in data/relay/status.json and checked separately by the hosted publication gate.
export const LEGACY_CADENCE_CONFIG = Object.freeze({schema:1,mode:'legacy',activatedAt:null,relayConfirmedAt:null});
export const DEFAULT_CADENCE_CONFIG = Object.freeze({"schema":1,"mode":"hourly","activatedAt":"2026-10-11T12:15:05.785Z","relayConfirmedAt":"2026-10-11T12:10:58.834Z"});
export const MAX_PUBLICATION_BATCH_SIZE = 6;
const timestamp = value => typeof value==='string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;

export function validateCadenceConfig(config) {
  if (!config || typeof config!=='object' || Array.isArray(config) || Object.keys(config).length!==4
    || !['schema','mode','activatedAt','relayConfirmedAt'].every(key=>Object.hasOwn(config,key)) || config.schema!==1)
    return ['Cadence configuration must have the fixed schema, mode and activation/relay timestamps.'];
  if (config.mode==='legacy') return config.activatedAt===null && config.relayConfirmedAt===null ? [] : ['Legacy cadence must have no activation or relay confirmation.'];
  if (config.mode!=='hourly' || !timestamp(config.activatedAt) || !timestamp(config.relayConfirmedAt)
    || Date.parse(config.relayConfirmedAt)>Date.parse(config.activatedAt))
    return ['Hourly cadence requires an exact UTC activation after the confirmed best-feed relay switch.'];
  return [];
}
export function normalizeCadenceConfig(config=DEFAULT_CADENCE_CONFIG) {
  const failures=validateCadenceConfig(config);if(failures.length)throw new Error(failures.join(' '));
  return {...config};
}
export function cadenceAt(date=new Date(),config=DEFAULT_CADENCE_CONFIG) {
  config=normalizeCadenceConfig(config);const time=new Date(date).getTime();
  if(!Number.isFinite(time))throw new Error('Invalid cadence time.');
  return config.mode==='hourly' && time>=Date.parse(config.activatedAt) ? 'hourly' : 'legacy';
}
export const dailyPublicationCap=(date=new Date(),config=DEFAULT_CADENCE_CONFIG)=>cadenceAt(date,config)==='hourly'?24:3;
export const researchEveryHours=(date=new Date(),config=DEFAULT_CADENCE_CONFIG)=>cadenceAt(date,config)==='hourly'?1:3;
