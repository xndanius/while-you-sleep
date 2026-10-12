import {spawnSync} from 'node:child_process';
import {readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {ROOT,sha256,stableJSON,readJSON,writeJSON} from './storage.mjs';

export const CODE_FREEZE=Object.freeze({id:'code-freeze-2026-10-12',timezone:'Europe/Vilnius',startsAt:'2026-10-12T15:00:00.000Z',endsAt:'2026-10-13T12:00:00.000Z'});
export const freezeRecordPath=root=>path.join(root,'data','maintenance',CODE_FREEZE.id+'.json');
export function codeFreezeActive(now=new Date()) {
  const timestamp=new Date(now).getTime();
  if(!Number.isFinite(timestamp))throw new Error('A valid clock is required to enforce the code freeze.');
  return timestamp>=Date.parse(CODE_FREEZE.startsAt)&&timestamp<Date.parse(CODE_FREEZE.endsAt);
}
export function codeFreezeStatus(now=new Date()) {
  const active=codeFreezeActive(now);
  return {...CODE_FREEZE,state:active?'active':new Date(now)<new Date(CODE_FREEZE.startsAt)?'planned':'ended',scope:'Code and RULES are frozen; hosted clock, hourly assessments, source and content records, and RSS publishing continue.'};
}
export function isFrozenCodePath(file) {
  return ['AGENTS.md','RULES.md','package.json','package-lock.json'].includes(file)||/^(?:\.github|lib|scripts|tests|integrations)\//.test(file)||/^public\//.test(file)&&!/^public\/(?:cards|api|p|method)\//.test(file)&&!['public/feed.xml','public/best.xml','public/.nojekyll','public/machine/index.html'].includes(file);
}
export async function codeSnapshot(root=ROOT) {
  const result=spawnSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'});
  if(result.status!==0)throw new Error('Cannot inspect repository code for the deployment freeze.');
  const names=[...new Set(result.stdout.split('\0').filter(isFrozenCodePath))].sort();
  const entries=await Promise.all(names.map(async file=>{
    const target=path.join(root,file);
    if(!(await lstat(target)).isFile())throw new Error('Frozen code must be a regular file: '+file);
    return [file,sha256(await readFile(target))];
  }));
  const files=Object.fromEntries(entries);
  return {files,codeSha256:sha256(stableJSON(files))};
}
export async function assertCodeFreeze({root=ROOT,now=new Date(),manifest}={}) {
  const state=codeFreezeStatus(now);
  if(state.state!=='active')return state;
  const record=manifest||await readJSON(freezeRecordPath(root));
  if(record.schema!==1||record.id!==CODE_FREEZE.id||record.startsAt!==CODE_FREEZE.startsAt||record.endsAt!==CODE_FREEZE.endsAt||!Number.isFinite(Date.parse(record.sealedAt))||Date.parse(record.sealedAt)>=Date.parse(CODE_FREEZE.startsAt)||!record.files?.['RULES.md']||record.codeSha256!==sha256(stableJSON(record.files||{})))
    throw new Error('Code freeze baseline is missing or invalid; refusing a code deployment.');
  const current=await codeSnapshot(root);
  if(current.codeSha256!==record.codeSha256) {
    const changed=[...new Set([...Object.keys(record.files),...Object.keys(current.files)])].filter(file=>record.files[file]!==current.files[file]);
    throw new Error('Code is frozen until 13 October 15:00 Vilnius. Changed files: '+changed.slice(0,8).join(', '));
  }
  return {...state,codeSha256:record.codeSha256};
}

// A newer authorized release may replace the planned seal before the window.
// The earlier immutable morning inventory is retained for v5 safety rollback.
export async function sealCodeFreeze({root=ROOT,now=new Date(),replaceBeforeFreeze=false}={}) {
  const timestamp=new Date(now).getTime();
  if(!Number.isFinite(timestamp)||timestamp>=Date.parse(CODE_FREEZE.startsAt))throw new Error('The code freeze baseline must be sealed before 18:00 Vilnius on 12 October.');
  let previous=null;
  try{previous=await readJSON(freezeRecordPath(root));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(previous&&!replaceBeforeFreeze)throw new Error('A planned freeze baseline already exists; an explicit pre-freeze replacement is required.');
  if(previous&&(previous.schema!==1||previous.id!==CODE_FREEZE.id||previous.codeSha256!==sha256(stableJSON(previous.files||{}))))throw new Error('The earlier code seal is invalid; refusing replacement.');
  const snapshot=await codeSnapshot(root);
  const record={schema:1,...CODE_FREEZE,sealedAt:new Date(now).toISOString(),...snapshot,...(previous?{replaces:{codeSha256:previous.codeSha256,sealedAt:previous.sealedAt}}:{})};
  await writeJSON(freezeRecordPath(root),record,{immutable:!previous});
  return record;
}
