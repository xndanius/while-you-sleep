import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {sha256,stableJSON} from '../lib/storage.mjs';
import {checkerAssessmentView} from '../lib/checker-assessment.mjs';
import {acceptCheckerOutput,checkerOutputSchema} from '../lib/checker-output.mjs';
import {omittedCandidateAssignments,validateOmittedCandidateRepair} from '../lib/omitted-candidate-repair.mjs';
import {completedAssessmentReasons,checkApproval} from '../lib/validation.mjs';

const runId='loop-40290814963-1';
const load=directory=>readFile(new URL(`../data/${directory}/${runId}.json`,import.meta.url),'utf8').then(JSON.parse);
const failure={outcome:'operational_failure',reason:'The draft is empty, but fresh sources contain two concrete workflow requests: restaurant order notifications and event-triggered email notifications. No exclusion rationale or candidate assessment is provided, so I cannot confirm a no-supported-candidate decision.',manifest:null};

test('40449249281 keeps a genuinely unscored title/body mismatch unresolved without inventing an assessment',async()=>{
 const id='loop-40449249281-1',read=directory=>readFile(new URL(`../data/${directory}/${id}.json`,import.meta.url),'utf8').then(JSON.parse);
 const [draft,context,run]=await Promise.all(['drafts','check-context','runs'].map(read)),before=stableJSON({draft,context,run});
 const foodURL='https://community.n8n.io/t/324685',food=context.sources.find(row=>row.url===foodURL),messenger=draft.candidates.find(row=>row.productUrl==='https://community.make.com/t/118271');
 assert.match(food.title,/Food Delivery Order Notifications/);assert.equal(food.text,'I’m exploring ways to automate workflows for a food delivery application similar to DoorDash.');assert.equal(food.text.includes(food.title),false);
 assert.deepEqual(Object.keys(messenger.scoring.criteria).sort(),['autonomy','ease','evidence','feasibility','profit']);assert.equal(Object.values(messenger.scoring.criteria).reduce((sum,row)=>sum+row.value,0)/5,4.4);
 assert.equal(draft.candidates.some(row=>row.productUrl===foodURL),false);assert.ok(draft.rejected.some(row=>row.productUrl===foodURL));
 const view=checkerAssessmentView(draft,context,{role:'final-checker'});assert.deepEqual(view.counts,{posts:0,candidates:1,rejected:8,uniqueConsidered:8});assert.deepEqual(view.draft,draft);assert.equal(view.advisoryOnly,true);
 assert.ok(view.inventory.find(row=>row.productUrl===foodURL).occurrences.every(row=>row.list==='rejected'));
 const finalResponse={outcome:'operational_failure',reason:'The empty draft cannot be confirmed: the fresh n8n discussion title explicitly requests automating food delivery order notifications, contradicting its exclusion as lacking a notification task. The final-checker contract permits no omission feedback, and this candidate has no five-criterion assessment.',manifest:null};
 assert.throws(()=>acceptCheckerOutput(finalResponse,draft,context,{expectedDraftSha256:sha256(stableJSON(draft)),expectedContextSha256:sha256(stableJSON(context))}),/operational failure/);
 assert.equal(checkerOutputSchema(draft,context,{allowOmittedCandidateRepair:false}).properties.repairFeedback,undefined);
 const assignment=omittedCandidateAssignments(draft,context).find(row=>row.productUrl===foodURL);assert.ok(assignment);
 const feedback={schema:1,kind:'omitted_candidate',runId:id,contextSha256:sha256(stableJSON(context)),rulesSha256:context.rulesSha256,draftSha256:context.draftSha256,sourceSnapshotSha256:context.sourceSnapshotSha256,policySha256:context.scoringPolicy.policySha256,demandContextSha256:context.demandContextSha256,omission:{...assignment,chore:'Synthetic title-only notification task.',evidenceQuote:food.title,reason:'Synthetic negative control: a title cannot be substituted for the bounded body quote.'}};
 assert.throws(()=>validateOmittedCandidateRepair(feedback,draft,context,{allowInitial:true}),/literal fresh chore quote/);
 assert.throws(()=>validateOmittedCandidateRepair(feedback,draft,context,{allowInitial:false}),/only in the trusted initial checker/);
 assert.equal(run.status,'no_post_unverified');assert.deepEqual(run.published,[]);assert.equal(stableJSON({draft,context,run}),before);
});
async function fixture(){const [draft,context]=await Promise.all([load('drafts'),load('check-context')]);return {draft,context};}
const pins=f=>({expectedDraftSha256:sha256(stableJSON(f.draft)),expectedContextSha256:sha256(stableJSON(f.context))});
function completed(f){
 const {context}=f;
 return {outcome:'completed',reason:'Synthetic completed-examination control; this is not the historical model outcome.',manifest:{runId,draftSha256:context.draftSha256,sourceSnapshotSha256:context.sourceSnapshotSha256,policySha256:context.scoringPolicy.policySha256,checks:[],completedAssessment:{schema:1,completed:true,decision:'no_supported_candidate',reason:'Synthetic fixture: all eight identities, three provisional candidate assessments and eight explicit exclusions were examined against the complete frozen input.',contextSha256:sha256(stableJSON(context)),rulesSha256:context.rulesSha256,draftSha256:context.draftSha256,sourceSnapshotSha256:context.sourceSnapshotSha256,policySha256:context.scoringPolicy.policySha256}}};
}

async function put(root,relative,value){const file=path.join(root,relative);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(value));}
async function fileHashes(root,relative=''){
 const result={};
 for(const entry of await readdir(path.join(root,relative),{withFileTypes:true})){
  const file=path.join(relative,entry.name);if(entry.isSymbolicLink())continue;
  if(entry.isDirectory())Object.assign(result,await fileHashes(root,file));else result[file]=sha256(await readFile(path.join(root,file)));
 }
 return result;
}
async function sandbox(t,f,{settlement=false}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'wys-checker-assessment-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const directory of ['lib','scripts'])await cp(new URL('../'+directory,import.meta.url),path.join(root,directory),{recursive:true});
 await mkdir(path.join(root,'public'));for(const name of ['schedule.js','cadence-config.js'])await cp(new URL('../public/'+name,import.meta.url),path.join(root,'public',name));
 await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),path.join(root,'node_modules'),'dir');
 await writeFile(path.join(root,'package.json'),' {"type":"module"}');await cp(new URL('../RULES.md',import.meta.url),path.join(root,'RULES.md'));
 const records={drafts:f.draft,'check-context':f.context};
 if(settlement){for(const directory of ['scheduling','slot-reservations','research','usage','learning-selection','source-scans'])records[directory]=await load(directory);await mkdir(path.join(root,'data/sources'),{recursive:true});await cp(new URL('../data/sources/registry.json',import.meta.url),path.join(root,'data/sources/registry.json'));}
 for(const [directory,record] of Object.entries(records))await put(root,`data/${directory}/${runId}.json`,record);
 const pages={};
 if(settlement)for(const source of f.context.sources){const url=new URL(source.url),hn=url.hostname==='news.ycombinator.com',number=Number(hn?url.searchParams.get('id'):url.pathname.split('/').at(-1));pages[hn?`https://hn.algolia.com/api/v1/items/${number}`:source.url+'.json']=JSON.stringify(hn?{id:number,title:source.title,text:source.text,created_at:source.postedAt}:{id:number,title:source.title,created_at:source.postedAt,post_stream:{posts:[{post_number:1,cooked:source.text}]}});}
 const preload=`import dns from 'node:dns/promises';import {syncBuiltinESMExports} from 'node:module';const ActualDate=Date;globalThis.Date=class extends ActualDate{constructor(...args){super(...(args.length?args:[${JSON.stringify(f.context.createdAt)}]));}static now(){return ActualDate.parse(${JSON.stringify(f.context.createdAt)});}};dns.lookup=async()=>[{address:'203.0.113.10',family:4}];syncBuiltinESMExports();const pages=${JSON.stringify(pages)},hosts=new Set(Object.keys(pages).map(value=>new URL(value).hostname));globalThis.fetch=async raw=>{const url=String(raw),parsed=new URL(url);if(parsed.pathname==='/robots.txt'&&hosts.has(parsed.hostname))return new Response('',{status:404,headers:{'content-type':'text/plain'}});if(Object.hasOwn(pages,url))return new Response(pages[url],{status:200,headers:{'content-type':'application/json'}});process.stderr.write('FORBIDDEN_NETWORK_CALL\\n');throw new Error('No unmapped source or model calls are permitted in this fixture.');};`;
 await writeFile(path.join(root,'offline.mjs'),preload);
 const env={PATH:process.env.PATH,NODE_OPTIONS:'--import='+path.join(root,'offline.mjs'),RUN_ID:runId,GITHUB_ACTIONS:'true',CHECKER_PHASE:'final',EXPECTED_DRAFT_SHA:pins(f).expectedDraftSha256,EXPECTED_CONTEXT_SHA:pins(f).expectedContextSha256,RULES_SHA256:f.context.rulesSha256,DEMAND_CONTRACT_VERSION:'1'};
 if(settlement){env.LOOP_SCHEDULING_SHA=sha256(stableJSON(records.scheduling));env.GITHUB_EVENT_NAME=records.scheduling.eventName;}
 const invoke=(script,args=[runId],extra={})=>{const result=spawnSync(process.execPath,['scripts/'+script+'.mjs',...args],{cwd:root,env:{...env,...extra},encoding:'utf8'});assert.doesNotMatch(result.stderr,/FORBIDDEN_NETWORK_CALL/);return result;};
 return {root,env,records,invoke,read:relative=>readFile(path.join(root,relative),'utf8').then(JSON.parse)};
}

test('the exact 40290814963 draft remains lossless: zero posts is three candidates and eight rejections, not empty work',async()=>{
 const f=await fixture(),before=stableJSON(f),view=checkerAssessmentView(f.draft,f.context,{role:'final-checker'});
 assert.deepEqual(view.counts,{posts:0,candidates:3,rejected:8,uniqueConsidered:8});assert.deepEqual(view.listPresence,{posts:true,candidates:true,rejected:true});assert.deepEqual(view.draft,f.draft);
 assert.equal(view.advisoryOnly,true);assert.equal(view.kind,'checker_assessment_view');assert.equal(view.bindings.contextSha256,pins(f).expectedContextSha256);
 for(const [index,candidate] of f.draft.candidates.entries()){
  assert.deepEqual(Object.keys(candidate.scoring.criteria).sort(),['autonomy','ease','evidence','feasibility','profit']);assert.deepEqual(view.draft.candidates[index],candidate);
  const item=view.inventory.find(row=>row.productUrl===candidate.productUrl);assert.ok(item.occurrences.some(row=>row.list==='candidates'&&row.index===index));assert.ok(item.occurrences.some(row=>row.list==='rejected'));
  assert.deepEqual(item.considerationEvidence,f.context.considerationEvidence.filter(row=>row.productUrl===candidate.productUrl));assert.deepEqual(item.primaryFetchDiagnostics,f.context.primaryFetchDiagnostics.filter(row=>row.productUrl===candidate.productUrl));
 }
 for(const [index,rejected] of f.draft.rejected.entries())assert.equal(view.draft.rejected[index].reason,rejected.reason);
 view.draft.candidates[0].reason='Changed view copy';assert.equal(stableJSON(f),before,'Reading or changing the view cannot mutate frozen inputs.');
});

test('both checker phases prepare a bound complete view and the inspector prints it without writing files',async t=>{
 for(const role of ['checker','final-checker']){
  const f=await fixture(),s=await sandbox(t,f),beforeDraft=await readFile(path.join(s.root,`data/drafts/${runId}.json`)),beforeContext=await readFile(path.join(s.root,`data/check-context/${runId}.json`));
  const prepared=s.invoke('prepare-run',[role],{CHECKER_PHASE:role==='checker'?'initial':'final'});assert.equal(prepared.status,0,prepared.stderr);
  const session=await s.read('.run/context.json'),view=await s.read('.run/checker-assessment.json');
  assert.equal(session.role,role);assert.deepEqual(session.checkerAssessment,{path:'.run/checker-assessment.json',sha256:sha256(stableJSON(view)),counts:view.counts,command:`node scripts/inspect-check-assessment.mjs ${runId}`});
  assert.deepEqual(view,checkerAssessmentView(f.draft,f.context,{role}));assert.deepEqual(view.counts,{posts:0,candidates:3,rejected:8,uniqueConsidered:8});
  const before=await fileHashes(s.root),inspected=s.invoke('inspect-check-assessment');assert.equal(inspected.status,0,inspected.stderr);assert.deepEqual(JSON.parse(inspected.stdout),view);assert.deepEqual(await fileHashes(s.root),before);
  assert.deepEqual(await readFile(path.join(s.root,`data/drafts/${runId}.json`)),beforeDraft);assert.deepEqual(await readFile(path.join(s.root,`data/check-context/${runId}.json`)),beforeContext);
 }
});

test('view construction refuses mismatches, malformed lists, private inputs and oversized complete views',async()=>{
 const changes=[
  f=>f.draft.runId='loop-999-1',f=>f.draft.candidates[0].reason='Changed without a new hash',f=>f.context.sources[0].text+=' changed',
  f=>{f.draft.candidates={};f.context.draftSha256=sha256(stableJSON(f.draft));},
  f=>{f.draft.rejected=[null];f.context.draftSha256=sha256(stableJSON(f.draft));},
  f=>{f.draft.candidates[0].reason='Contact person@example.invalid';f.context.draftSha256=sha256(stableJSON(f.draft));},
  f=>{f.context.considerationEvidence[0].contact='person@example.invalid';},
  f=>{f.context.sources[0].text='Contact person@example.invalid';f.context.sourceSnapshotSha256=sha256(stableJSON(f.context.sources));},
  f=>{f.draft.steps=[{message:'x'.repeat(6000001)}];f.context.draftSha256=sha256(stableJSON(f.draft));},
 ];
 for(const change of changes){const f=await fixture();change(f);assert.throws(()=>checkerAssessmentView(f.draft,f.context,{role:'final-checker'}),undefined,change.toString());}
 const f=await fixture();for(const role of ['writer','repair','unknown',undefined])assert.throws(()=>checkerAssessmentView(f.draft,f.context,{role}),/identity/);
});

test('legacy absent optional lists stay absent while explicit empty lists remain distinguishable',async()=>{
 const f=await fixture();delete f.draft.candidates;delete f.draft.rejected;f.context.draftSha256=sha256(stableJSON(f.draft));
 const absent=checkerAssessmentView(f.draft,f.context,{role:'checker'});assert.deepEqual(absent.counts,{posts:0,candidates:0,rejected:0,uniqueConsidered:0});assert.deepEqual(absent.listPresence,{posts:true,candidates:false,rejected:false});assert.deepEqual(absent.draft,f.draft);
 f.draft.candidates=[];f.draft.rejected=[];f.context.draftSha256=sha256(stableJSON(f.draft));assert.deepEqual(checkerAssessmentView(f.draft,f.context,{role:'checker'}).listPresence,{posts:true,candidates:true,rejected:true});
});

test('the read-only inspector refuses stale, oversized, malformed, foreign-role and externally mismatched records',async t=>{
 const s=await sandbox(t,await fixture());assert.equal(s.invoke('prepare-run',['final-checker']).status,0);
 const files=['.run/context.json','.run/checker-assessment.json',`data/drafts/${runId}.json`,`data/check-context/${runId}.json`],original=new Map(await Promise.all(files.map(async file=>[file,await readFile(path.join(s.root,file))])));
 const changes=[
  async()=>{const d=await s.read(`data/drafts/${runId}.json`);d.candidates[0].reason='Changed';await put(s.root,`data/drafts/${runId}.json`,d);},
  async()=>{const d=await s.read('.run/checker-assessment.json');d.counts.candidates=0;await put(s.root,'.run/checker-assessment.json',d);},
  async()=>{const d=await s.read('.run/context.json');d.role='writer';await put(s.root,'.run/context.json',d);},
  async()=>{const d=await s.read('.run/context.json');d.checkerAssessment.path='../foreign.json';await put(s.root,'.run/context.json',d);},
  async()=>{const d=await s.read('.run/context.json');d.checkerAssessment.counts.rejected=0;await put(s.root,'.run/context.json',d);},
  async()=>writeFile(path.join(s.root,`.run/checker-assessment.json`),' '.repeat(6000001)),
  async()=>writeFile(path.join(s.root,`data/drafts/${runId}.json`),' '.repeat(3000001)),
  async()=>writeFile(path.join(s.root,`.run/context.json`),'malformed'),
 ];
 for(const change of changes){for(const [file,bytes] of original)await writeFile(path.join(s.root,file),bytes);await change();const before=await fileHashes(s.root),result=s.invoke('inspect-check-assessment');assert.equal(result.status,1,change.toString());assert.equal(JSON.parse(result.stdout).available,false);assert.deepEqual(await fileHashes(s.root),before);}
 for(const [file,bytes] of original)await writeFile(path.join(s.root,file),bytes);
 for(const extra of [{EXPECTED_DRAFT_SHA:'0'.repeat(64)},{EXPECTED_CONTEXT_SHA:'0'.repeat(64)},{EXPECTED_CONTEXT_SHA:'bad'}])assert.equal(s.invoke('inspect-check-assessment',[runId],extra).status,1);
 assert.equal(s.invoke('inspect-check-assessment',['loop-999-1']).status,1);
});

test('the reading aid cannot turn the saved operational failure into an assessment, while a synthetic complete refusal has no approvals',async()=>{
 const f=await fixture(),run=await load('runs'),learning=await load('learning'),before=stableJSON(f);checkerAssessmentView(f.draft,f.context,{role:'final-checker'});
 assert.throws(()=>acceptCheckerOutput(failure,f.draft,f.context,pins(f)),/operational failure/);
 const control=completed(f),manifest=acceptCheckerOutput(control,f.draft,f.context,pins(f));assert.deepEqual(completedAssessmentReasons(f.draft,f.context,manifest),[]);assert.deepEqual(checkApproval(f.draft,f.context,manifest),[]);assert.deepEqual(manifest.checks,[]);
 assert.equal(stableJSON(f),before);assert.equal(run.status,'no_post_unverified');assert.equal(run.checkedAssessment,undefined);assert.deepEqual(run.published,[]);assert.ok(learning.samples.every(row=>row.status==='unknown'&&row.reward===null));
});

test('a complete reading view cannot bypass missing fresh evidence or changed completion fingerprints',async()=>{
 const f=await fixture(),view=checkerAssessmentView(f.draft,f.context,{role:'final-checker'});assert.deepEqual(view.draft,f.draft);
 const stale=completed(f);stale.manifest.completedAssessment.contextSha256='0'.repeat(64);
 assert.throws(()=>acceptCheckerOutput(stale,f.draft,f.context,pins(f)),/fingerprint/);
 assert.throws(()=>acceptCheckerOutput(completed(f),f.draft,f.context,{...pins(f),expectedContextSha256:'0'.repeat(64)}),/trusted frozen/);
 const unavailable=structuredClone(f);unavailable.context.sources=[];unavailable.context.sourceSnapshotSha256=sha256(stableJSON([]));
 const readingOnly=checkerAssessmentView(unavailable.draft,unavailable.context,{role:'final-checker'});
 assert.deepEqual(readingOnly.draft,f.draft);assert.deepEqual(readingOnly.counts,view.counts);assert.equal(readingOnly.advisoryOnly,true);
 assert.throws(()=>acceptCheckerOutput(completed(unavailable),unavailable.draft,unavailable.context,pins(unavailable)),/fresh|evidence|source/i,'Complete candidate visibility is not evidence availability or a completed independent assessment.');
 assert.throws(()=>acceptCheckerOutput(completed(f),f.draft,{},pins(f)),/trusted frozen/);
});

test('isolated settlement distinguishes the unchanged operational failure from a synthetic completed no-post examination',async t=>{
 for(const [response,success] of [[failure,false],[completed(await fixture()),true]]){
  const f=await fixture(),s=await sandbox(t,f,{settlement:true});assert.equal(s.invoke('prepare-run',['final-checker']).status,0);
  await put(s.root,'.run/checker-response.json',response);const accepted=s.invoke('accept-check-output');assert.equal(accepted.status,0,accepted.stderr);assert.equal(JSON.parse(accepted.stdout).completed,success);
  const stage=(verified=true)=>({result:'success',outputs:{verified:String(verified),model_completed:'true',model_attempted:'true',privacy_safe:'true',...(!verified?{unverified_code:'checker_examination_unverified',unverified_reason:'Synthetic replay of the saved incomplete examination.'}:{})}});
  const jobs={writer:stage(),checker:stage(),repair:stage(),final_check:stage(success)};
  const finalized=s.invoke('finalize-run',[runId],{MODEL_JOB_RESULTS:JSON.stringify(jobs)});assert.equal(finalized.status,0,finalized.stderr);
  const run=await s.read(`data/runs/${runId}.json`);assert.deepEqual(run.published,[]);assert.equal(run.status,success?'completed_no_post':'no_post_unverified',JSON.stringify({failures:run.operationalFailures,stderr:finalized.stderr}));assert.equal(run.assessmentOutcome,success?'completed':'unverified');
  assert.equal(Boolean(run.checkedAssessment?.completed),success);if(success)assert.deepEqual(run.checkedAssessment.checkedPostIds,[]);else assert.equal(run.unverifiedAssessment.completed,false);
  assert.deepEqual(await s.read(`data/drafts/${runId}.json`),f.draft);assert.deepEqual(await s.read(`data/check-context/${runId}.json`),f.context);
 }
});
