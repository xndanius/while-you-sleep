import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {sha256,stableJSON} from '../lib/storage.mjs';
import {demandContextHash} from '../lib/demand.mjs';
import {checkerOutputSchema,acceptCheckerOutput} from '../lib/checker-output.mjs';
import {omittedCandidateAssignments,validateOmittedCandidateRepair} from '../lib/omitted-candidate-repair.mjs';
import {completedAssessmentReasons,checkApproval,assessmentJobReasons} from '../lib/validation.mjs';
import {repairFeedback} from '../scripts/save-first-check.mjs';
import {preserveRepairConsiderations} from '../scripts/preserve-repair-considerations.mjs';
import {deriveLearningReceipt,validateLearningReceipt} from '../lib/learning.mjs';
import {SCORING_KEYS} from '../lib/scoring.mjs';
import {candidateEvidenceTasks} from '../lib/candidate-evidence-tasks.mjs';

const runId='loop-39368251410-1',makeUrl='https://community.make.com/t/117567';
const load=async(directory)=>JSON.parse(await readFile(new URL(`../data/${directory}/${runId}.json`,import.meta.url),'utf8'));
async function fixture(schema=1){
 const [draft,context]=await Promise.all([load('drafts'),load('check-context')]);
 const assignment=context.demandContext.discussionBatchPolicy.leadAssignments.find(row=>row.productUrl===makeUrl),source=context.sources.find(row=>row.id===assignment.demandSourceId);
 const record={schema,kind:'omitted_candidate',runId,contextSha256:sha256(stableJSON(context)),rulesSha256:context.rulesSha256,draftSha256:context.draftSha256,sourceSnapshotSha256:context.sourceSnapshotSha256,policySha256:context.scoringPolicy.policySha256,demandContextSha256:context.demandContextSha256,omission:{...assignment,chore:'Examine a narrow diagnosis report for an existing Make build.',evidenceQuote:source.text,reason:'The explicit debugging chore received no criterion assessment; examine a bounded proposed output and its limits.',...(schema===3?{quoteAnchorSha256:sha256(source.text)}:{})}};
 return {draft,context,record,response:{outcome:'needs_repair',reason:'An original concrete discussion chore was excluded without a criterion assessment.',manifest:null,repairFeedback:record}};
}
const expected=f=>({expectedDraftSha256:sha256(stableJSON(f.draft)),expectedContextSha256:sha256(stableJSON(f.context)),expectedFeedbackSha256:sha256(stableJSON(f.record))});
function rebind(f){
 f.context.draftSha256=sha256(stableJSON(f.draft));f.context.sourceSnapshotSha256=sha256(stableJSON(f.context.sources));
 if(f.context.demandContext){f.context.demandContext.registrySha256=sha256(stableJSON(f.context.demandContext.registrySources));f.context.demandContextSha256=demandContextHash(f.context.demandContext);}
 Object.assign(f.record,{runId:f.context.runId,contextSha256:sha256(stableJSON(f.context)),rulesSha256:f.context.rulesSha256,draftSha256:f.context.draftSha256,sourceSnapshotSha256:f.context.sourceSnapshotSha256,policySha256:f.context.scoringPolicy.policySha256,demandContextSha256:f.context.demandContextSha256});
}
function manifest(f){return {runId,draftSha256:f.context.draftSha256,sourceSnapshotSha256:f.context.sourceSnapshotSha256,policySha256:f.context.scoringPolicy.policySha256,checks:[],completedAssessment:{schema:1,completed:true,decision:'no_supported_candidate',reason:'The full fresh batch was independently examined; the bounded hypotheses remain unsupported or below threshold.',contextSha256:sha256(stableJSON(f.context)),rulesSha256:f.context.rulesSha256,draftSha256:f.context.draftSha256,sourceSnapshotSha256:f.context.sourceSnapshotSha256,policySha256:f.context.scoringPolicy.policySha256}};}

test('one exact unscored discussion exclusion can authenticate feedback without a completed assessment or approval',async()=>{
 const f=await fixture(),before=stableJSON(f),options={allowOmittedCandidateRepair:true,...expected(f)},schema=checkerOutputSchema(f.draft,f.context,options);
 assert.ok(schema.properties.outcome.enum.includes('needs_repair'));assert.ok(schema.properties.repairFeedback);assert.equal(schema.properties.manifest.anyOf[1].properties.checks.maxItems,0);
 assert.equal(omittedCandidateAssignments(f.draft,f.context).some(row=>row.productUrl===makeUrl),true);
 assert.equal(omittedCandidateAssignments(f.draft,f.context).some(row=>row.productUrl.includes('/322807')),false,'the already scored n8n candidate has no retry route');
 assert.equal(acceptCheckerOutput(f.response,f.draft,f.context,options),f.record);
 assert.equal(validateOmittedCandidateRepair(f.record,f.draft,f.context,{allowInitial:true,...expected(f),requireFeedbackSha256:true}),f.record);
 assert.ok(completedAssessmentReasons(f.draft,f.context,f.record).length);assert.deepEqual(checkApproval(f.draft,f.context,f.record),[]);
 assert.equal(f.record.completedAssessment,undefined);assert.equal(f.record.checks,undefined);assert.equal(stableJSON(f),before);
});

test('initial omitted-candidate feedback accepts only its exact payload or complete validated envelope',async()=>{
 const f=await fixture(),options={allowOmittedCandidateRepair:true,...expected(f)},before=stableJSON(f);
 for(const existing of [undefined,structuredClone(f.record),structuredClone(f.response)])assert.equal(acceptCheckerOutput(f.response,f.draft,f.context,{...options,existing}),f.record);
 for(const mutate of [value=>value.reason='A changed outer answer about the same omission.',value=>value.outcome='completed',value=>value.extraField='Unvalidated outer metadata']){
  const existing=structuredClone(f.response);mutate(existing);assert.deepEqual(existing.repairFeedback,f.record);assert.throws(()=>acceptCheckerOutput(f.response,f.draft,f.context,{...options,existing}),/disagree/);
 }
 for(const existing of [null,false,0,'',42,'scalar',[],{}])assert.throws(()=>acceptCheckerOutput(f.response,f.draft,f.context,{...options,existing}),/disagree/);
 for(const mutate of [value=>value.repairFeedback.contextSha256='b'.repeat(64),value=>delete value.repairFeedback.omission.evidenceQuote,value=>value.repairFeedback.omission.extraField='Unvalidated nested metadata']){
  const invalid=structuredClone(f.response);mutate(invalid);assert.throws(()=>acceptCheckerOutput(invalid,f.draft,f.context,{...options,existing:structuredClone(invalid)}));
 }
 assert.throws(()=>acceptCheckerOutput(f.response,f.draft,f.context,{...options,existing:f.response,allowOmittedCandidateRepair:false}),/phase|batch/);
 const failure={outcome:'operational_failure',reason:'The synthetic independent examination did not complete.',manifest:null,repairFeedback:null};assert.throws(()=>acceptCheckerOutput(failure,f.draft,f.context,{...options,existing:failure}),/operational failure/);
 assert.equal(stableJSON(f),before);
});

test('final, legacy, nonempty, already scored and non-discussion batches cannot open this route',async()=>{
 const f=await fixture();assert.throws(()=>acceptCheckerOutput(f.response,f.draft,f.context,expected(f)),/phase|batch/);
 assert.equal(checkerOutputSchema(f.draft,f.context).properties.outcome.enum.includes('needs_repair'),false);
 for(const change of [g=>g.context.assessmentContractVersion=null,g=>delete g.context.demandContext.discussionBatchPolicy,g=>g.draft.posts.push({...g.draft.candidates[0]}),g=>g.draft.candidates.push({...g.draft.candidates[0],productUrl:makeUrl}),g=>g.draft.rejected=g.draft.rejected.filter(row=>row.productUrl!==makeUrl)]){
  const g=await fixture();change(g);rebind(g);assert.throws(()=>acceptCheckerOutput(g.response,g.draft,g.context,{allowOmittedCandidateRepair:true,...expected(g)}));
 }
 for(const field of ['scoring','ratings','score','scores','criteria','writerCriteria','overall']){const g=await fixture();g.draft.rejected.find(row=>row.productUrl===makeUrl)[field]={value:4};rebind(g);assert.equal(omittedCandidateAssignments(g.draft,g.context).some(row=>row.productUrl===makeUrl),false);assert.throws(()=>acceptCheckerOutput(g.response,g.draft,g.context,{allowOmittedCandidateRepair:true,...expected(g)}));}
 const repaired={...f.draft,repairAttempt:undefined};assert.throws(()=>acceptCheckerOutput(f.response,repaired,f.context,{allowOmittedCandidateRepair:false}),/phase|batch/);
 const completed={outcome:'completed',reason:'The fresh batch is fully examined.',manifest:manifest(f)};
 assert.deepEqual(acceptCheckerOutput(completed,f.draft,f.context),completed.manifest);
 assert.deepEqual(acceptCheckerOutput({...completed,repairFeedback:null},f.draft,f.context,{allowOmittedCandidateRepair:true}),completed.manifest);
 assert.throws(()=>acceptCheckerOutput({...completed,repairFeedback:f.record},f.draft,f.context,{allowOmittedCandidateRepair:true}),/cannot contain/);
});

test('all identities, hashes, assignment fields, exact quotes and record shapes fail closed on tampering',async()=>{
 const mutations=[g=>g.record.runId='loop-999-1',...['contextSha256','rulesSha256','draftSha256','sourceSnapshotSha256','policySha256','demandContextSha256'].map(key=>g=>g.record[key]='0'.repeat(64)),g=>g.record.omission.productUrl+='?substitute=1',g=>g.record.omission.segment='education',g=>g.record.omission.demandSourceId='unavailable',g=>g.record.omission.registrySourceId='unadmitted',g=>g.record.omission.kind='builder',g=>g.record.omission.evidenceQuote='A paraphrased or invented debugging task.',g=>g.record.omission.evidenceQuote='short',g=>g.record.omission.reason='Contact person@example.invalid for details.',g=>g.record.omission.extra='not allowed',g=>g.record.completedAssessment={completed:true},g=>g.record.checks=[]];
 for(const change of mutations){const f=await fixture();change(f);assert.throws(()=>acceptCheckerOutput(f.response,f.draft,f.context,{allowOmittedCandidateRepair:true}),undefined,change.toString());}
 const f=await fixture();assert.throws(()=>acceptCheckerOutput({...f.response,manifest:manifest(f)},f.draft,f.context,{allowOmittedCandidateRepair:true}),/cannot contain/);
 assert.throws(()=>acceptCheckerOutput(f.response,f.draft,f.context,{allowOmittedCandidateRepair:true,existing:{...f.record,kind:'other'}}),/disagree/);
 assert.throws(()=>validateOmittedCandidateRepair(f.record,f.draft,f.context,{allowInitial:true,requireFeedbackSha256:true}),/fingerprint/);
 assert.throws(()=>validateOmittedCandidateRepair(f.record,f.draft,f.context,{allowInitial:true,expectedFeedbackSha256:'0'.repeat(64)}),/fingerprint/);
});

test('rebound stale, private, unavailable or forged evidence still cannot authenticate an omission',async()=>{
 const changes=[g=>{g.context.considerationEvidence.find(row=>row.productUrl===makeUrl).availableSourceIds=[];},g=>{const s=g.context.sources.find(row=>row.url===makeUrl);s.verifiedAt=s.fetchedAt=new Date(Date.parse(g.context.createdAt)-4*3600000).toISOString();},g=>{const s=g.context.sources.find(row=>row.url===makeUrl);s.text='Contact person@example.invalid to finish an existing build.';s.taskExcerpts=[s.text];g.record.omission.evidenceQuote=s.text;},g=>g.context.sources.find(row=>row.url===makeUrl).id='forged',g=>g.context.noveltyContext.postsSha256='0'.repeat(64),g=>g.context.demandContext.authorizedSources=g.context.demandContext.authorizedSources.filter(row=>row.sourceId!==g.record.omission.demandSourceId)];
 for(const change of changes){const f=await fixture();change(f);rebind(f);assert.throws(()=>validateOmittedCandidateRepair(f.record,f.draft,f.context,{allowInitial:true,...expected(f),requireFeedbackSha256:true}),undefined,change.toString());}
});

test('schema 3 anchor feedback preserves the batch through one repair and a fresh independent no-post check',async t=>{
 const f=await fixture(3),pins=expected(f),feedback=repairFeedback(f.draft,f.context,f.record,pins);
 assert.equal(f.record.schema,3);assert.equal(feedback.omittedCandidate.quoteAnchorSha256,f.record.omission.quoteAnchorSha256);
 assert.deepEqual(feedback.approvedPostIds,[]);assert.deepEqual(feedback.repairPostIds,[]);assert.deepEqual(feedback.omittedCandidate,f.record.omission);assert.equal(feedback.initialFeedbackSha256,pins.expectedFeedbackSha256);
 const id=f.record.omission.demandSourceId,quote=f.record.omission.evidenceQuote;
 const considered={title:'A bounded Make diagnosis hypothesis',productUrl:makeUrl,sourceIds:[id],segment:f.record.omission.segment,demandEvidence:{kind:'community_request',sourceIds:[id],chore:f.record.omission.chore,evidenceQuote:quote},scoring:{criteria:Object.fromEntries(SCORING_KEYS.map(key=>[key,{value:4,reason:key==='profit'?'Hypothesis: a small operations team may value diagnosis; payment is unproved.':key==='evidence'?'The literal discussion excerpt identifies debugging, with no implementation or outcome proof.':'An unproved diagnosis-report hypothesis needs supplied examples, human review and implementation evidence.',sourceIds:[id]}]))},reason:'The proposed diagnosis output remains below threshold with limited implementation evidence.'};
 const repaired={...structuredClone(f.draft),candidates:[considered],repairAttempt:undefined};
 const options={expectedDraftSha256:pins.expectedDraftSha256,expectedContextSha256:pins.expectedContextSha256,firstCheck:f.record,expectedRepairFeedbackSha256:pins.expectedFeedbackSha256};
 const result=preserveRepairConsiderations(f.draft,f.context,repaired,options);assert.equal(result.repairAttempt,1);assert.equal(result.candidates.length,2);assert.equal(result.rejected.length,f.draft.rejected.length);
 for(const firstCheck of [undefined,{...f.record,kind:'other'},{...f.record,omission:{...f.record.omission,reason:'Modified by repair.'}}])assert.throws(()=>preserveRepairConsiderations(f.draft,f.context,repaired,{...options,firstCheck}));
 assert.throws(()=>repairFeedback(f.draft,f.context,f.record),/fingerprint/);
 assert.deepEqual(considered.demandEvidence.sourceIds,[id]);assert.deepEqual(considered.sourceIds,[id]);assert.ok(Object.values(considered.scoring.criteria).every(row=>stableJSON(row.sourceIds)===stableJSON([id])));
 const sandbox=await isolated(t,f),saved=sandbox.invoke('save-first-check');assert.equal(saved.status,0,saved.stderr);
 await writeFile(path.join(sandbox.root,'data','drafts',runId+'.json'),JSON.stringify(repaired));
 const preserved=sandbox.invoke('preserve-repair-considerations');assert.equal(preserved.status,0,preserved.stderr);assert.deepEqual(await sandbox.read('drafts'),result);
 // Keep the actual novelty memory and original sealed research. Only DNS and
 // the exact independently fetched public response bodies are injected here.
 await cp(new URL('../data/posts',import.meta.url),path.join(sandbox.root,'data','posts'),{recursive:true});
 const fixed=new Date(Date.parse(f.context.createdAt)+60000).toISOString(),pages={};
 for(const source of f.context.sources){const url=new URL(source.url),hn=url.hostname==='news.ycombinator.com',number=Number(hn?url.searchParams.get('id'):url.pathname.split('/').at(-1));pages[hn?`https://hn.algolia.com/api/v1/items/${number}`:source.url+'.json']=JSON.stringify(hn?{id:number,title:source.title,text:source.text,created_at:source.postedAt}:{id:number,title:source.title,created_at:source.postedAt,post_stream:{posts:[{post_number:1,cooked:source.text}]}});}
 await writeFile(path.join(sandbox.root,'offline.mjs'),`import dns from 'node:dns/promises';import {syncBuiltinESMExports} from 'node:module';const ActualDate=Date;globalThis.Date=class extends ActualDate{constructor(...args){super(...(args.length?args:[${JSON.stringify(fixed)}]));}static now(){return ActualDate.parse(${JSON.stringify(fixed)});}};dns.lookup=async()=>[{address:'203.0.113.10',family:4}];syncBuiltinESMExports();const pages=${JSON.stringify(pages)};globalThis.fetch=async value=>{const url=String(value);if(new URL(url).pathname==='/robots.txt')return new Response('',{status:404,headers:{'content-type':'text/plain'}});if(!Object.hasOwn(pages,url))throw new Error('Unmapped HTTP is forbidden in omitted-candidate fixtures.');return new Response(pages[url],{status:200,headers:{'content-type':'application/json'}});};`);
 const preparationEnv={DEMAND_CONTRACT_VERSION:'1',EXPECTED_LEARNING_SELECTION_SHA:sha256(stableJSON(sandbox.records['learning-selection'])),EXPECTED_RESEARCH_SHA:sha256(stableJSON(sandbox.records.research))};
 // The old unrealistic fixture's n8n demand binding fails the real guard.
 const corrupt=structuredClone(result);Object.assign(corrupt.candidates.find(row=>row.productUrl===makeUrl),{demandEvidence:structuredClone(f.draft.candidates[0].demandEvidence)});await writeFile(path.join(sandbox.root,'data','drafts',runId+'.json'),JSON.stringify(corrupt));const refused=sandbox.invoke('prepare-check',preparationEnv);assert.equal(refused.status,1);assert.match(refused.stderr,/exact sealed discussion post|verifiable privacy-safe demand/);
 await writeFile(path.join(sandbox.root,'data','drafts',runId+'.json'),JSON.stringify(result));const prepared=sandbox.invoke('prepare-check',preparationEnv);assert.equal(prepared.status,0,prepared.stderr);
 const final={draft:await sandbox.read('drafts'),context:await sandbox.read('check-context')},actualMake=final.draft.candidates.find(row=>row.productUrl===makeUrl),freshMake=final.context.sources.find(source=>source.id===id);
 assert.equal(final.context.createdAt,fixed);assert.equal(freshMake.verifiedAt,fixed);assert.equal(freshMake.url,makeUrl);assert.equal(freshMake.text,quote);assert.deepEqual(final.context.health,[]);assert.equal(final.context.primaryFetchDiagnostics.length,f.context.considerationEvidence.length);
 assert.deepEqual(actualMake.demandEvidence,considered.demandEvidence);assert.ok(freshMake.text.includes(actualMake.demandEvidence.evidenceQuote));assert.ok(final.context.considerationEvidence.find(row=>row.productUrl===makeUrl).availableSourceIds.includes(id));assert.equal(final.context.noveltyContext.posts.length,f.context.noveltyContext.posts.length);
 const finalPrepared=spawnSync(process.execPath,['scripts/prepare-run.mjs','final-checker'],{cwd:sandbox.root,env:{...sandbox.env,...preparationEnv,CHECKER_PHASE:'final'},encoding:'utf8'});assert.equal(finalPrepared.status,0,finalPrepared.stderr);
 assert.equal(JSON.parse(await readFile(path.join(sandbox.root,'.run','checker-output-schema.json'),'utf8')).properties.outcome.enum.includes('needs_repair'),false);
 const fingerprints=sandbox.invoke('fingerprint-check');assert.equal(fingerprints.status,0,fingerprints.stderr);const values=Object.fromEntries(fingerprints.stdout.trim().split('\n').map(line=>line.split('=')));
 assert.equal(values.draft_sha256,sha256(stableJSON(final.draft)));assert.equal(values.context_sha256,sha256(stableJSON(final.context)));
 assert.throws(()=>acceptCheckerOutput(f.response,final.draft,final.context),/phase|batch/);
 const completed=manifest(final);await writeFile(path.join(sandbox.root,'.run','checker-response.json'),JSON.stringify({outcome:'completed',reason:'The repaired batch was fully examined.',manifest:completed}));
 const finalEnv={CHECKER_PHASE:'final',EXPECTED_DRAFT_SHA:values.draft_sha256,EXPECTED_CONTEXT_SHA:values.context_sha256};
 const accepted=sandbox.invoke('accept-check-output',finalEnv);assert.equal(accepted.status,0,accepted.stderr);assert.deepEqual(await sandbox.read('checks'),completed);assert.match(accepted.stdout,/"completed":true/);assert.equal(sandbox.invoke('preserve-repair-considerations',{},['--verify-only']).status,0);
 assert.deepEqual(assessmentJobReasons(result,{writer:{result:'success'},checker:{result:'success',outputs:{verified:'true'}},repair:{result:'success'},final_check:{result:'success',outputs:{verified:'true'}}},{required:true}),[]);
 assert.ok(assessmentJobReasons(result,{writer:{result:'success'},checker:{result:'success',outputs:{verified:'true'}},repair:{result:'success'},final_check:{result:'skipped'}},{required:true}).length);
});

test('frozen 40822510539 omission repair preserves the other five complete candidate plans and evidence',async()=>{
 const id='loop-40822510539-1',read=directory=>readFile(new URL(`../data/${directory}/${id}.json`,import.meta.url),'utf8').then(JSON.parse);
 const [first,context,firstCheck,repaired]=await Promise.all([
  readFile(new URL(`../data/drafts/${id}-first.json`,import.meta.url),'utf8').then(JSON.parse),
  readFile(new URL(`../data/check-context/${id}-first.json`,import.meta.url),'utf8').then(JSON.parse),
  readFile(new URL(`../data/checks/${id}-first.json`,import.meta.url),'utf8').then(JSON.parse),read('drafts'),
 ]);
 const before=stableJSON({first,context,firstCheck,repaired});
 const options={expectedDraftSha256:sha256(stableJSON(first)),expectedContextSha256:sha256(stableJSON(context)),firstCheck,expectedRepairFeedbackSha256:sha256(stableJSON(firstCheck))};
 const preserved=preserveRepairConsiderations(first,context,repaired,options);
 assert.equal(first.candidates.length,5);assert.equal(preserved.candidates.length,6);
 for(const candidate of first.candidates)assert.deepEqual(preserved.candidates.find(row=>row.productUrl===candidate.productUrl),candidate,'one omitted sketch request must not replace an unrelated concrete plan with generic prose');
 const csv=preserved.candidates.find(row=>row.productUrl==='https://community.n8n.io/t/325109');
 const tasks=candidateEvidenceTasks({candidate:csv,source:context.sources.find(row=>row.id===csv.demandEvidence.sourceIds[0]),capabilitySources:context.sources.filter(row=>row.role==='building')});
 assert.ok(tasks.some(row=>row.kind==='local_fixture'));assert.ok(tasks.some(row=>row.kind==='existing_access'),'specific duplicate-key and phone-trigger gaps must survive into the next evidence tasks');
 assert.deepEqual(preserved.candidates.find(row=>row.productUrl===firstCheck.omission.productUrl),repaired.candidates.find(row=>row.productUrl===firstCheck.omission.productUrl));
 assert.equal(preserved.posts.length,0);assert.equal(stableJSON({first,context,firstCheck,repaired}),before);
 const ordinary=preserveRepairConsiderations(first,context,repaired,{expectedDraftSha256:options.expectedDraftSha256,expectedContextSha256:options.expectedContextSha256});
 assert.deepEqual(ordinary.candidates,repaired.candidates,'ordinary score/claim repair retains its existing ability to revise a candidate');
 const promotion=structuredClone(repaired);promotion.posts.push({...first.candidates[0],id:'a'.repeat(24)});
 assert.throws(()=>preserveRepairConsiderations(first,context,promotion,options),/unrelated|omission/);
});

async function isolated(t,f){
 const root=await mkdtemp(path.join(os.tmpdir(),'wys-omitted-candidate-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const directory of ['lib','scripts'])await cp(new URL('../'+directory,import.meta.url),path.join(root,directory),{recursive:true});
 await mkdir(path.join(root,'public'));for(const name of ['schedule.js','cadence-config.js'])await cp(new URL('../public/'+name,import.meta.url),path.join(root,'public',name));
 await cp(new URL('../RULES.md',import.meta.url),path.join(root,'RULES.md'));await writeFile(path.join(root,'package.json'),'{"type":"module"}');await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),path.join(root,'node_modules'),'dir');
 const records={drafts:f.draft,'check-context':f.context,checks:f.record};
 for(const directory of ['research','scheduling','slot-reservations','learning-selection','source-scans'])records[directory]=await load(directory);
 for(const [directory,record] of Object.entries(records)){await mkdir(path.join(root,'data',directory),{recursive:true});await writeFile(path.join(root,'data',directory,runId+'.json'),JSON.stringify(record));}
 await mkdir(path.join(root,'data','sources'));await cp(new URL('../data/sources/registry.json',import.meta.url),path.join(root,'data','sources','registry.json'));
 await mkdir(path.join(root,'.run'));await writeFile(path.join(root,'.run','checker-response.json'),JSON.stringify(f.response));
 const fixed=f.context.createdAt;await writeFile(path.join(root,'offline.mjs'),`const ActualDate=Date;globalThis.Date=class extends ActualDate{constructor(...args){super(...(args.length?args:[${JSON.stringify(fixed)}]));}static now(){return ActualDate.parse(${JSON.stringify(fixed)});}};globalThis.fetch=async()=>{throw new Error('Live HTTP is forbidden in omitted-candidate fixtures.');};`);
 const pins=expected(f),env={PATH:process.env.PATH,NODE_OPTIONS:`--import=${path.join(root,'offline.mjs')}`,RUN_ID:runId,GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',CHECKER_PHASE:'initial',LOOP_SCHEDULING_SHA:sha256(stableJSON(records.scheduling)),EXPECTED_DRAFT_SHA:pins.expectedDraftSha256,EXPECTED_CONTEXT_SHA:pins.expectedContextSha256,EXPECTED_FIRST_DRAFT_SHA:pins.expectedDraftSha256,EXPECTED_FIRST_CONTEXT_SHA:pins.expectedContextSha256,EXPECTED_REPAIR_FEEDBACK_SHA:pins.expectedFeedbackSha256,RULES_SHA256:f.context.rulesSha256,GITHUB_OUTPUT:path.join(root,'outputs')};
 return {root,env,records,invoke:(name,extra={},args=[])=>spawnSync(process.execPath,[`scripts/${name}.mjs`,runId,...args],{cwd:root,env:{...env,...extra},encoding:'utf8'}),read:directory=>readFile(path.join(root,'data',directory,runId+'.json'),'utf8').then(JSON.parse)};
}

test('the real accept script canonicalizes an exact initial feedback envelope and denies it in the final phase',async t=>{
 const f=await fixture(),sandbox=await isolated(t,f),target=path.join(sandbox.root,'data/checks',runId+'.json');
 // Only isolated future-compatibility copies change here. The historical
 // refusal, its manifest absence and unknown learning result remain untouched.
 const before=await Promise.all(['drafts','check-context'].map(directory=>readFile(path.join(sandbox.root,'data',directory,runId+'.json'),'utf8')));
 await writeFile(target,JSON.stringify(f.response));
 const initial=sandbox.invoke('accept-check-output');assert.equal(initial.status,0,initial.stderr);assert.match(initial.stdout,/"completed":false/);assert.match(initial.stdout,/"repairFeedback":true/);
 const canonical=await sandbox.read('checks');assert.deepEqual(canonical,f.record);assert.equal(sha256(stableJSON(canonical)),expected(f).expectedFeedbackSha256);assert.equal(Object.hasOwn(canonical,'outcome'),false);assert.equal(Object.hasOwn(canonical,'repairFeedback'),false);assert.equal(canonical.completedAssessment,undefined);assert.equal(canonical.checks,undefined);
 const outputs=await readFile(sandbox.env.GITHUB_OUTPUT,'utf8');assert.match(outputs,/verified=true/);assert.match(outputs,/repair_feedback_verified=true/);
 for(const [index,directory] of ['drafts','check-context'].entries())assert.equal(await readFile(path.join(sandbox.root,'data',directory,runId+'.json'),'utf8'),before[index]);
 await writeFile(target,JSON.stringify(f.response));const final=sandbox.invoke('accept-check-output',{CHECKER_PHASE:'final'});assert.equal(final.status,0,final.stderr);assert.match(final.stdout,/"verified":false/);await assert.rejects(sandbox.read('checks'),{code:'ENOENT'});
});

test('trusted CLI authenticates and pins feedback, then final acceptance rejects it without another repair',async t=>{
 const f=await fixture(),sandbox=await isolated(t,f);
 const prepare=role=>spawnSync(process.execPath,['scripts/prepare-run.mjs',role],{cwd:sandbox.root,env:{...sandbox.env,CHECKER_PHASE:role==='checker'?'initial':'final'},encoding:'utf8'});
 const prepared=prepare('checker');assert.equal(prepared.status,0,prepared.stderr);assert.equal(JSON.parse(await readFile(path.join(sandbox.root,'.run','context.json'),'utf8')).omittedCandidateRepairAllowed,true);
 await writeFile(path.join(sandbox.root,'.run','checker-response.json'),JSON.stringify(f.response));
 const accepted=sandbox.invoke('accept-check-output');assert.equal(accepted.status,0,accepted.stderr);
 const outputs=await readFile(sandbox.env.GITHUB_OUTPUT,'utf8');assert.match(outputs,/verified=true/);assert.match(outputs,/repair_feedback_verified=true/);assert.match(outputs,new RegExp('repair_feedback_sha256='+expected(f).expectedFeedbackSha256));
 assert.equal((await sandbox.read('checks')).completedAssessment,undefined);
 const verdict=sandbox.invoke('check-verdict');assert.equal(verdict.status,0,verdict.stderr);assert.match(verdict.stdout,/"repair":true/);
 const saved=sandbox.invoke('save-first-check');assert.equal(saved.status,0,saved.stderr);const first=JSON.parse(await readFile(path.join(sandbox.root,'data','checks',runId+'-first.json'),'utf8'));assert.deepEqual(first,f.record);
 await writeFile(path.join(sandbox.root,'data','drafts',runId+'.json'),JSON.stringify(f.draft));
 const before=await readFile(path.join(sandbox.root,'data','drafts',runId+'.json'),'utf8'),verified=sandbox.invoke('preserve-repair-considerations',{},['--verify-only']);assert.equal(verified.status,0,verified.stderr);assert.match(verified.stdout,/"verifyOnly":true/);assert.equal(await readFile(path.join(sandbox.root,'data','drafts',runId+'.json'),'utf8'),before);
 await writeFile(path.join(sandbox.root,'data','checks',runId+'-first.json'),JSON.stringify({...f.record,omission:{...f.record.omission,reason:'Changed after final model access.'}}));assert.notEqual(sandbox.invoke('preserve-repair-considerations',{},['--verify-only']).status,0);
 await writeFile(path.join(sandbox.root,'data','checks',runId+'-first.json'),JSON.stringify(f.record));
 const finalPrepared=prepare('final-checker');assert.equal(finalPrepared.status,0,finalPrepared.stderr);assert.equal(JSON.parse(await readFile(path.join(sandbox.root,'.run','context.json'),'utf8')).omittedCandidateRepairAllowed,false);assert.equal(JSON.parse(await readFile(path.join(sandbox.root,'.run','checker-output-schema.json'),'utf8')).properties.outcome.enum.includes('needs_repair'),false);
 await writeFile(path.join(sandbox.root,'.run','checker-response.json'),JSON.stringify(f.response));
 const final=sandbox.invoke('accept-check-output',{CHECKER_PHASE:'final'});assert.equal(final.status,0,final.stderr);assert.match(final.stdout,/"verified":false/);await assert.rejects(sandbox.read('checks'),{code:'ENOENT'});
});

test('feedback-only, failed repair and incomplete final checks settle unverified with null learning reward',async t=>{
 const stage=(result,outputs={})=>({result,outputs:{model_attempted:'true',model_completed:result==='success'?'true':'false',privacy_safe:'true',...outputs}}),skipped={result:'skipped'};
 const cases=[{repair:skipped,final_check:skipped},{repair:stage('failure'),final_check:skipped},{repair:stage('success'),final_check:skipped},{repair:stage('success'),final_check:stage('failure',{verified:'false',unverified_code:'checker_output_unverified',unverified_reason:'The fresh final checker did not complete.'})},{repair:stage('success'),final_check:stage('success',{verified:'true'})}];
 for(const phases of cases){
  const f=await fixture(),sandbox=await isolated(t,f),jobs={writer:stage('success'),checker:stage('success',{verified:'true',repair_feedback_verified:'true',repair_feedback_sha256:expected(f).expectedFeedbackSha256}),...phases};
  const executed=sandbox.invoke('finalize-run',{MODEL_JOB_RESULTS:JSON.stringify(jobs)});assert.equal(executed.status,0,executed.stderr);assert.doesNotMatch(executed.stderr,/Live HTTP is forbidden/);
  const run=await sandbox.read('runs');assert.equal(run.status,'no_post_unverified');assert.equal(run.assessmentOutcome,'unverified');assert.deepEqual(run.published,[]);assert.equal(run.checkedAssessment,undefined);assert.equal(run.unverifiedAssessment.completed,false);
  const receipt=deriveLearningReceipt({run,selection:sandbox.records['learning-selection'],scan:sandbox.records['source-scans'],draft:f.draft,context:f.context,manifest:f.record,expectedSelectionSha256:sha256(stableJSON(sandbox.records['learning-selection'])),expectedScanSha256:sha256(stableJSON(sandbox.records['source-scans'])),expectedDraftSha256:expected(f).expectedDraftSha256,expectedContextSha256:expected(f).expectedContextSha256});
  assert.deepEqual(validateLearningReceipt(receipt),[]);assert.equal(receipt.outcome,'unverified');assert.ok(receipt.samples.every(sample=>sample.status==='unknown'&&sample.reward===null));
 }
});

test('operational failures and the immutable historical refusal remain unverified without feedback or invented reward',async()=>{
 const f=await fixture(),failure={outcome:'operational_failure',reason:'The independent examination did not complete.',manifest:null};
 assert.throws(()=>acceptCheckerOutput(failure,f.draft,f.context,{allowOmittedCandidateRepair:true}),/operational failure/);
 assert.throws(()=>acceptCheckerOutput({...failure,repairFeedback:f.record},f.draft,f.context,{allowOmittedCandidateRepair:true}),/operational failure/);
 const [run,learning]=await Promise.all([load('runs'),load('learning')]);assert.equal(run.status,'no_post_unverified');assert.equal(run.assessmentOutcome,'unverified');assert.equal(run.checkedAssessment,undefined);assert.ok(learning.samples.every(sample=>sample.status==='unknown'&&sample.reward===null));
});
