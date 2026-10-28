import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {sha256,stableJSON} from '../lib/storage.mjs';
import {checkerOutputSchema,acceptCheckerOutput} from '../lib/checker-output.mjs';
import {omittedCandidateAssignments,validateOmittedCandidateRepair} from '../lib/omitted-candidate-repair.mjs';
import {completedAssessmentReasons,checkApproval} from '../lib/validation.mjs';

const runId='loop-39821880827-1',kinoId='9962065ed0bf29f61d73330d',groundhogId='95221892a43c435e353ed726';
const read=async url=>JSON.parse(await readFile(url,'utf8'));
async function fixture(){
 const [draft,context,logged]=await Promise.all([read(new URL(`../data/drafts/${runId}.json`,import.meta.url)),read(new URL(`../data/check-context/${runId}.json`,import.meta.url)),read(new URL('./fixtures/checker-identity-39821880827.json',import.meta.url))]);
 assert.equal(sha256(stableJSON(draft)),context.draftSha256);assert.equal(sha256(stableJSON(context)),logged.finalEnvelope.repairFeedback.contextSha256);
 const valid=structuredClone(logged.finalEnvelope),source=context.sources.find(row=>row.id===groundhogId);
 valid.repairFeedback.schema=3;
 valid.repairFeedback.omission.quoteAnchorSha256=sha256(source.text);
 valid.repairFeedback.omission.evidenceQuote=source.text;
 valid.repairFeedback.omission.chore='Examine local test email and provider API emulation.';
 valid.repairFeedback.omission.reason='Synthetic control: examine this unscored assigned discussion using its own literal excerpt; no score or approval is established.';
 return {draft,context,...logged,valid,source};
}
const pins=f=>({expectedDraftSha256:sha256(stableJSON(f.draft)),expectedContextSha256:sha256(stableJSON(f.context)),allowOmittedCandidateRepair:true});
const feedbackBranches=schema=>{const omission=schema.properties.repairFeedback?.anyOf[1]?.properties.omission;return omission?omission.anyOf||[omission]:[];};

// Exhaustively evaluate the bounded JSON Schema vocabulary emitted by this
// repository; fail on new unsupported keywords instead of passing silently.
// No external validator dependency, package install, model or HTTP is needed.
function auditSchema(schema){
 const known=new Set(['type','additionalProperties','properties','required','enum','anyOf','minLength','maxLength','items','minItems','maxItems','minimum','maximum']);
 for(const key of Object.keys(schema))assert.ok(known.has(key),'Unsupported schema keyword: '+key);
 for(const child of Object.values(schema.properties||{}))auditSchema(child);
 for(const child of schema.anyOf||[])auditSchema(child);
 if(schema.items)auditSchema(schema.items);
}
function schemaAllows(schema,value){auditSchema(schema);return schemaMatches(schema,value);}
function schemaMatches(schema,value){
 if(schema.anyOf&&!schema.anyOf.some(branch=>schemaMatches(branch,value)))return false;
 if(schema.enum&&!schema.enum.some(item=>stableJSON(item)===stableJSON(value)))return false;
 const object=value!==null&&typeof value==='object'&&!Array.isArray(value),types={object,array:Array.isArray(value),string:typeof value==='string',integer:Number.isInteger(value),boolean:typeof value==='boolean',null:value===null};
 if(schema.type){assert.ok(Object.hasOwn(types,schema.type));if(!types[schema.type])return false;}
 if(typeof value==='string'&&(schema.minLength!==undefined&&[...value].length<schema.minLength||schema.maxLength!==undefined&&[...value].length>schema.maxLength))return false;
 if(typeof value==='number'&&(schema.minimum!==undefined&&value<schema.minimum||schema.maximum!==undefined&&value>schema.maximum))return false;
 if(Array.isArray(value)&&(schema.minItems!==undefined&&value.length<schema.minItems||schema.maxItems!==undefined&&value.length>schema.maxItems||schema.items&&!value.every(item=>schemaMatches(schema.items,item))))return false;
 if(object){
  if((schema.required||[]).some(key=>!Object.hasOwn(value,key)))return false;
  for(const [key,item] of Object.entries(value)){if(Object.hasOwn(schema.properties||{},key)){if(!schemaMatches(schema.properties[key],item))return false;}else if(schema.additionalProperties===false)return false;}
 }
 return true;
}

test('the actual HN swap is excluded while the already-scored original remains ineligible',async()=>{
 const f=await fixture(),before=stableJSON(f),schema=checkerOutputSchema(f.draft,f.context,{allowOmittedCandidateRepair:true});
 const kino=f.draft.candidates.find(row=>row.productUrl===f.intermediateFeedback.omission.productUrl);
 assert.deepEqual(Object.keys(kino.scoring.criteria).sort(),['autonomy','ease','evidence','feasibility','profit']);
 assert.equal(omittedCandidateAssignments(f.draft,f.context).some(row=>row.demandSourceId===kinoId),false);
 assert.equal(schemaAllows(schema,f.finalEnvelope),false,'Groundhog identity cannot carry the unrelated Kino H264/ProRes quote.');
 const original={...structuredClone(f.finalEnvelope),repairFeedback:structuredClone(f.intermediateFeedback)};
 assert.equal(schemaAllows(schema,original),false,'A correct Kino quote cannot reopen an already scored candidate.');
 assert.throws(()=>acceptCheckerOutput(original,f.draft,f.context,pins(f)),/exact original unscored rejected/);
 assert.throws(()=>acceptCheckerOutput(f.finalEnvelope,f.draft,f.context,pins(f)),/literal fresh chore quote/);
 assert.equal(schemaAllows(schema,f.valid),true);const accepted=acceptCheckerOutput(f.valid,f.draft,f.context,pins(f));
 const wrongLiteral=structuredClone(f.valid);wrongLiteral.repairFeedback.omission.evidenceQuote=f.intermediateFeedback.omission.evidenceQuote;
 assert.equal(schemaAllows(schema,wrongLiteral),true,'Free text stays parseable; deterministic acceptance enforces the exact anchor.');
 assert.throws(()=>acceptCheckerOutput(wrongLiteral,f.draft,f.context,pins(f)),/literal fresh chore quote/);
 assert.equal(accepted,f.valid.repairFeedback);assert.equal(accepted.completedAssessment,undefined);assert.equal(accepted.checks,undefined);
 assert.ok(completedAssessmentReasons(f.draft,f.context,accepted).length);assert.deepEqual(checkApproval(f.draft,f.context,accepted),[]);assert.equal(stableJSON(f),before);
});

test('each eligible schema branch pins the hash of its complete short fresh excerpt',async()=>{
 const f=await fixture(),schema=checkerOutputSchema(f.draft,f.context,{allowOmittedCandidateRepair:true}),branches=feedbackBranches(schema);
 assert.ok(branches.length>1);assert.ok(branches.length<=10);
 for(const branch of branches){
  const properties=branch.properties,id=properties.demandSourceId.enum[0],source=f.context.sources.find(row=>row.id===id);
  assert.ok(source.text.length>=25&&source.text.length<=200);assert.deepEqual(properties.quoteAnchorSha256.enum,[sha256(source.text)]);assert.equal(properties.evidenceQuote.enum,undefined);
  assert.equal(properties.productUrl.enum[0],source.url);assert.equal(properties.registrySourceId.enum[0],source.registrySourceId);assert.equal(properties.segment.enum[0],source.segment);
 }
 assert.ok(branches.some(branch=>f.context.sources.find(source=>source.id===branch.properties.demandSourceId.enum[0]).text.length<100),'Admitted short discussions remain eligible.');
 const sourceBefore=stableJSON(f.context.sources);assert.ok(Buffer.byteLength(JSON.stringify(schema))<30000);assert.equal(stableJSON(f.context.sources),sourceBefore);
});

test('missing, unavailable, stale, forged and private source data cannot acquire an omission branch',async()=>{
 const mutations=[
  g=>g.context.sources=g.context.sources.filter(row=>row.id!==groundhogId),
  g=>g.context.considerationEvidence.find(row=>row.productUrl===g.source.url).availableSourceIds=[],
  g=>{const s=g.context.sources.find(row=>row.id===groundhogId);s.verifiedAt=s.fetchedAt=new Date(Date.parse(g.context.createdAt)-4*3600000).toISOString();},
  g=>g.context.sources.find(row=>row.id===groundhogId).id='f'.repeat(24),
  g=>{const s=g.context.sources.find(row=>row.id===groundhogId);s.text='Contact person@example.invalid for this local email workflow.';s.taskExcerpts=[s.text];},
  g=>{const s=g.context.sources.find(row=>row.id===groundhogId);s.text='Short';s.taskExcerpts=[s.text];},
  g=>{const s=g.context.sources.find(row=>row.id===groundhogId);s.text='x'.repeat(201);s.taskExcerpts=[s.text];},
  g=>{const s=g.context.sources.find(row=>row.id===groundhogId);s.providerEvidence={provider:'apify'};s.providerProofVerified=true;s.livePostRefetched=false;},
 ];
 for(const mutate of mutations){
  const f=await fixture();mutate(f);f.context.sourceSnapshotSha256=sha256(stableJSON(f.context.sources));
  const schema=checkerOutputSchema(f.draft,f.context,{allowOmittedCandidateRepair:true});
  assert.equal(feedbackBranches(schema).some(branch=>branch.properties.demandSourceId.enum[0]===groundhogId),false,mutate.toString());
 }
});

test('new full-excerpt schemas do not invalidate historical literal shorter feedback',async()=>{
 const name='loop-39399457136-1-first',draft=await read(new URL(`../data/drafts/${name}.json`,import.meta.url)),context=await read(new URL(`../data/check-context/${name}.json`,import.meta.url)),record=await read(new URL(`../data/checks/${name}.json`,import.meta.url));
 const source=context.sources.find(row=>row.id===record.omission.demandSourceId);assert.ok(record.omission.evidenceQuote.length<source.text.length);
 const expected={expectedDraftSha256:sha256(stableJSON(draft)),expectedContextSha256:sha256(stableJSON(context)),expectedFeedbackSha256:sha256(stableJSON(record)),requireFeedbackSha256:true,allowInitial:true};
 assert.equal(validateOmittedCandidateRepair(record,draft,context,expected),record);
 const envelope={outcome:'needs_repair',reason:'Historical exact literal shorter feedback.',manifest:null,repairFeedback:record};
 assert.equal(schemaAllows(checkerOutputSchema(draft,context,{allowOmittedCandidateRepair:true}),envelope),false);
 assert.equal(acceptCheckerOutput(envelope,draft,context,{...expected,allowOmittedCandidateRepair:true}),record);
});

async function sandbox(t,f){
 const root=await mkdtemp(path.join(os.tmpdir(),'wys-checker-identity-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const directory of ['lib','scripts'])await cp(new URL('../'+directory,import.meta.url),path.join(root,directory),{recursive:true});
 await mkdir(path.join(root,'public'));for(const name of ['schedule.js','cadence-config.js'])await cp(new URL('../public/'+name,import.meta.url),path.join(root,'public',name));
 await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),path.join(root,'node_modules'),'dir');await writeFile(path.join(root,'package.json'),' {"type":"module"}');
 for(const [directory,record] of [['drafts',f.draft],['check-context',f.context]]){await mkdir(path.join(root,'data',directory),{recursive:true});await writeFile(path.join(root,'data',directory,runId+'.json'),JSON.stringify(record));}
 await mkdir(path.join(root,'.run'));await writeFile(path.join(root,'.run','checker-response.json'),JSON.stringify(f.valid));
 await writeFile(path.join(root,'offline.mjs'),"globalThis.fetch=async()=>{throw new Error('Network and model calls are forbidden in this fixture.');};");
 const env={PATH:process.env.PATH,NODE_OPTIONS:'--import='+path.join(root,'offline.mjs'),GITHUB_ACTIONS:'true',RUN_ID:runId,CHECKER_PHASE:'initial',EXPECTED_DRAFT_SHA:pins(f).expectedDraftSha256,EXPECTED_CONTEXT_SHA:pins(f).expectedContextSha256,GITHUB_OUTPUT:path.join(root,'outputs')};
 return {root,target:path.join(root,'data','checks',runId+'.json'),invoke:(script,extra={})=>spawnSync(process.execPath,['scripts/'+script+'.mjs',runId,...(script==='guard-private-artifacts'?['checker']:[])],{cwd:root,env:{...env,...extra},encoding:'utf8'})};
}

test('one final envelope passes privacy and is persisted canonically only by trusted acceptance',async t=>{
 const f=await fixture(),s=await sandbox(t,f);await assert.rejects(readFile(s.target),{code:'ENOENT'});
 const guarded=s.invoke('guard-private-artifacts');assert.equal(guarded.status,0,guarded.stderr);assert.equal(JSON.parse(guarded.stdout).safe,true);
 const accepted=s.invoke('accept-check-output');assert.equal(accepted.status,0,accepted.stderr);assert.equal(JSON.parse(accepted.stdout).repairFeedback,true);
 const saved=await read(s.target);assert.deepEqual(saved,f.valid.repairFeedback);assert.equal(saved.completedAssessment,undefined);assert.equal(saved.checks,undefined);
 assert.match(await readFile(path.join(s.root,'outputs'),'utf8'),new RegExp('repair_feedback_sha256='+sha256(stableJSON(saved))));
 for(const [directory,expected] of [['drafts',f.draft],['check-context',f.context]])assert.deepEqual(await read(path.join(s.root,'data',directory,runId+'.json')),expected);
 const legacy=structuredClone(saved);legacy.omission.reason='A conflicting legacy saved answer.';await writeFile(s.target,JSON.stringify(legacy));
 const conflict=s.invoke('accept-check-output');assert.equal(conflict.status,0);assert.match(conflict.stdout,/file and final feedback disagree/);await assert.rejects(readFile(s.target),{code:'ENOENT'});
 const final=s.invoke('accept-check-output',{CHECKER_PHASE:'final'});assert.equal(final.status,0);assert.match(final.stdout,/phase|batch/);await assert.rejects(readFile(s.target),{code:'ENOENT'});
});

test('the sole final envelope is still withheld by privacy before acceptance',async t=>{
 const f=await fixture(),s=await sandbox(t,f),privateEnvelope=structuredClone(f.valid);privateEnvelope.reason='Contact person@example.invalid for the decision.';
 await writeFile(path.join(s.root,'.run','checker-response.json'),JSON.stringify(privateEnvelope));
 const guarded=s.invoke('guard-private-artifacts');assert.equal(guarded.status,0,guarded.stderr);assert.equal(JSON.parse(guarded.stdout).safe,false);
 await assert.rejects(readFile(path.join(s.root,'.run','checker-response.json')),{code:'ENOENT'});await assert.rejects(readFile(s.target),{code:'ENOENT'});
});
