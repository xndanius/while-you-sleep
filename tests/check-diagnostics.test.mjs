import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,lstat,mkdir,mkdtemp,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {hash,sha256,stableJSON} from '../lib/storage.mjs';
import {DISCUSSION_SOURCE_CATALOG,discussionEvidenceURL} from '../lib/discussion-sources.mjs';
import {CHECK_DIAGNOSTICS_MAX_BYTES,checkDiagnosticsReasons,createCheckDiagnostics,sealedDiscussionAssignmentReasons} from '../lib/check-diagnostics.mjs';
import {importCheckDiagnostics} from '../scripts/import-check-diagnostics.mjs';

const runId='loop-39405925881-1',phase='initial',now='2026-10-20T10:12:30.000Z';
const load=async directory=>JSON.parse(await readFile(new URL(`../data/${directory}/${runId}.json`,import.meta.url),'utf8'));
function pins(f){return {runId,phase,expectedResearchSha256:sha256(stableJSON(f.research)),expectedSelectionSha256:sha256(stableJSON(f.selection)),expectedDraftSha256:sha256(stableJSON(f.draft))};}
function options(f){return {...pins(f),research:f.research,selection:f.selection,draft:f.draft,expectedSha256:sha256(stableJSON(f.receipt))};}
async function fixture(){
 const [research,selection,draft]=await Promise.all(['research','learning-selection','drafts'].map(load)),assignments=research.enrichment.discussionBatch.leadAssignments;
 // This denial is deliberately synthetic. The historical failed run did not
 // retain the denied host; this fixture never reconstructs it as Shopify.
 const denied=assignments.find(row=>row.productUrl.startsWith('https://community.shopify.com/')),definition=DISCUSSION_SOURCE_CATALOG.find(row=>row.id===denied.registrySourceId),adapterUrl=discussionEvidenceURL(definition,{id:denied.demandSourceId,registrySourceId:denied.registrySourceId,url:denied.productUrl});
 const failure={sourceId:denied.demandSourceId,productUrl:denied.productUrl,registrySourceId:denied.registrySourceId,adapterUrl,robotsUrl:new URL('/robots.txt',adapterUrl).toString(),stage:'robots',code:'robots_unavailable',httpStatus:429,observedAt:now};
 const f={research,selection,draft};f.receipt=createCheckDiagnostics({...pins(f),research,selection,draft,successfulSourceIds:assignments.filter(row=>row!==denied).map(row=>row.demandSourceId),failures:[failure]});return f;
}
function rebindOriginal(f){f.research.learningSelection=structuredClone(f.selection);Object.assign(f.receipt,{researchSha256:sha256(stableJSON(f.research)),selectionSha256:sha256(stableJSON(f.selection)),draftSha256:sha256(stableJSON(f.draft)),assignments:structuredClone(f.research.enrichment.discussionBatch.leadAssignments)});}

test('diagnostics preserve all four sealed assignments and only typed synthetic outcomes without authority or content',async()=>{
 const f=await fixture(),original=stableJSON({research:f.research,selection:f.selection,draft:f.draft});assert.deepEqual(sealedDiscussionAssignmentReasons({...pins(f),research:f.research,selection:f.selection}),[]);assert.deepEqual(checkDiagnosticsReasons(f.receipt,options(f)),[]);
 assert.deepEqual(f.receipt.assignments,f.research.enrichment.discussionBatch.leadAssignments);assert.equal(f.receipt.assignments.length,4);assert.equal(f.receipt.successfulSourceIds.length,3);assert.equal(f.receipt.failures.length,1);assert.equal(f.receipt.failures[0].httpStatus,429);
 assert.equal(f.receipt.authorizedSources,undefined);assert.equal(f.receipt.completedAssessment,undefined);assert.equal(f.receipt.checks,undefined);assert.equal(f.receipt.reward,undefined);assert.equal(f.receipt.scoring,undefined);
 const bytes=JSON.stringify(f.receipt);assert.ok(Buffer.byteLength(bytes)<CHECK_DIAGNOSTICS_MAX_BYTES);assert.ok(f.research.sources.every(source=>!bytes.includes(source.text)));assert.doesNotMatch(bytes,/"(?:text|title|reason|message|scoring|scores|claimChecks|scoreChecks|pass|reward)"/);assert.equal(stableJSON({research:f.research,selection:f.selection,draft:f.draft}),original);
 const historical=await load('runs');assert.equal(historical.status,'no_post_unverified');assert.equal(historical.checkPreparationDiagnostics,undefined,'No denied host is retroactively assigned to the historical failure.');
});

test('all exact original pins, tuple identities and source-family bounds are independently required',async()=>{
 const mutations=[f=>f.research.runId='loop-123-1',f=>f.selection.producer.stage='post_model',f=>f.selection.selectionStrategy='mixed-recovery-v1',f=>f.research.enrichment.discussionBatch.maxLeads=11,f=>f.research.enrichment.discussionBatch.leadAssignments.push(f.research.enrichment.discussionBatch.leadAssignments[0]),f=>f.research.enrichment.discussionBatch.leadAssignments[0].productUrl='https://foreign.example.com/post',f=>f.research.enrichment.discussionBatch.leadAssignments[0].segment='unknown',f=>f.research.enrichment.discussionBatch.leadAssignments[0].extra='foreign',f=>f.research.sources.find(row=>row.id===f.research.enrichment.discussionBatch.leadAssignments[0].demandSourceId).registrySourceId='a'.repeat(24),f=>f.research.sources.push(structuredClone(f.research.sources.find(row=>row.id===f.research.enrichment.discussionBatch.leadAssignments[0].demandSourceId)))];
 for(const mutate of mutations){const f=await fixture();mutate(f);rebindOriginal(f);assert.ok(sealedDiscussionAssignmentReasons({...pins(f),research:f.research,selection:f.selection}).length,mutate.toString());}
 const f=await fixture();for(const field of ['expectedResearchSha256','expectedSelectionSha256'])assert.ok(sealedDiscussionAssignmentReasons({...pins(f),research:f.research,selection:f.selection,[field]:'0'.repeat(64)}).length);
 const mismatch=await fixture();mismatch.research.learningSelection.reason='Changed embedded selection.';assert.ok(sealedDiscussionAssignmentReasons({...pins(mismatch),research:mismatch.research,selection:mismatch.selection}).length);
 const many=await fixture(),tuple=many.research.enrichment.discussionBatch.leadAssignments.find(row=>row.productUrl.includes('ycombinator')),source=many.research.sources.find(row=>row.id===tuple.demandSourceId),url='https://news.ycombinator.com/item?id=99999999';many.research.sources.push({...source,id:hash(url),url,productUrl:url});many.research.enrichment.discussionBatch.leadAssignments.push({...tuple,productUrl:url,demandSourceId:hash(url)});rebindOriginal(many);assert.ok(sealedDiscussionAssignmentReasons({...pins(many),research:many.research,selection:many.selection}).some(reason=>/three/.test(reason)));
});

test('receipt tampering cannot omit, duplicate, reorder, replace or approve an assigned outcome',async()=>{
 const mutations=[f=>f.receipt.kind='completedAssessment',f=>f.receipt.phase='final',f=>f.receipt.runId='loop-123-1',...['researchSha256','selectionSha256','draftSha256'].map(key=>f=>f.receipt[key]='0'.repeat(64)),f=>f.receipt.assignments.reverse(),f=>f.receipt.assignments.pop(),f=>f.receipt.successfulSourceIds.pop(),f=>f.receipt.successfulSourceIds.push(f.receipt.successfulSourceIds[0]),f=>f.receipt.successfulSourceIds.push(f.receipt.failures[0].sourceId),f=>f.receipt.successfulSourceIds[0]='a'.repeat(24),f=>f.receipt.failures.push(structuredClone(f.receipt.failures[0])),f=>f.receipt.failures=[],f=>f.receipt.checks=[],f=>f.receipt.completedAssessment={completed:true},f=>f.receipt.reward=0,f=>f.receipt.failures[0].message='A response body must never be retained.' ];
 for(const mutate of mutations){const f=await fixture();mutate(f);assert.ok(checkDiagnosticsReasons(f.receipt,options(f)).length,mutate.toString());}
 const f=await fixture(),pinned=options(f);f.receipt.failures[0].httpStatus=503;assert.ok(checkDiagnosticsReasons(f.receipt,pinned).length,'Rehashing is not accepted without a fresh trusted output pin.');
 for(const key of ['expectedSha256','expectedResearchSha256','expectedSelectionSha256','expectedDraftSha256']){const x=await fixture();assert.ok(checkDiagnosticsReasons(x.receipt,{...options(x),[key]:undefined}).length,key);}
 const changed=await fixture(),before=options(changed);changed.draft.rejected[0].reason='Changed after the diagnostic pin.';assert.ok(checkDiagnosticsReasons(changed.receipt,before).length);
});

test('failure metadata accepts only exact known URLs, strict stage/code pairs and honest bounded statuses',async()=>{
 const changes=[row=>row.sourceId='a'.repeat(24),row=>row.registrySourceId='a'.repeat(24),row=>row.productUrl+='?substitute=1',row=>row.adapterUrl='https://foreign.example.com/page',row=>row.adapterUrl+='?substitute=1',row=>row.robotsUrl='https://foreign.example.com/robots.txt',row=>row.robotsUrl=new URL('/profile/private',row.adapterUrl).toString(),row=>row.adapterUrl=null,row=>row.stage='model',row=>row.code='approve',row=>row.stage='fetch',row=>row.httpStatus=200,row=>row.httpStatus=404,row=>row.httpStatus=410,row=>row.httpStatus='429',row=>row.httpStatus=600,row=>row.observedAt='not a date',row=>row.observedAt='2026-10-20T10:12:30Z',row=>row.text='A forbidden response excerpt.'];
 for(const change of changes){const f=await fixture();change(f.receipt.failures[0]);assert.ok(checkDiagnosticsReasons(f.receipt,options(f)).length,change.toString());}
 const generic=await fixture();Object.assign(generic.receipt.failures[0],{stage:'validation',code:'evidence_unavailable',adapterUrl:null,robotsUrl:null,httpStatus:null});assert.deepEqual(checkDiagnosticsReasons(generic.receipt,options(generic)),[]);
 const fetched=await fixture();Object.assign(fetched.receipt.failures[0],{stage:'fetch',code:'source_http_error',robotsUrl:null,httpStatus:503});assert.deepEqual(checkDiagnosticsReasons(fetched.receipt,options(fetched)),[]);fetched.receipt.failures[0].httpStatus=null;assert.ok(checkDiagnosticsReasons(fetched.receipt,options(fetched)).length);
 const final=await fixture();final.receipt.phase='final';assert.deepEqual(checkDiagnosticsReasons(final.receipt,{...options(final),phase:'final'}),[]);assert.ok(checkDiagnosticsReasons(final.receipt,{...options(final),phase:'checker'}).length);
});

async function sandbox(t,f){
 const root=await mkdtemp(path.join(os.tmpdir(),'wys-check-diagnostics-'));t.after(()=>rm(root,{recursive:true,force:true}));const directory=path.join(root,'staging');await mkdir(directory);
 for(const [name,value] of [['research',f.research],['drafts',f.draft],['learning-selection',f.selection]]){await mkdir(path.join(root,'data',name),{recursive:true});await writeFile(path.join(root,'data',name,runId+'.json'),JSON.stringify(value));}
 const file=path.join(directory,runId+'.json');await writeFile(file,JSON.stringify(f.receipt));const args={root,directory,...options(f)};delete args.research;delete args.draft;delete args.selection;return {root,directory,file,args,target:path.join(root,'data','check-diagnostics',runId+'.json')};
}
test('import binds the canonical separate artifact, is immutable/idempotent and changes no content inputs',async t=>{
 const f=await fixture(),s=await sandbox(t,f),inputs=await Promise.all(['research','drafts','learning-selection'].map(name=>readFile(path.join(s.root,'data',name,runId+'.json'),'utf8')));
 assert.deepEqual(await importCheckDiagnostics(s.args),f.receipt);assert.deepEqual(await importCheckDiagnostics(s.args),f.receipt);assert.equal((await lstat(s.target)).isFile(),true);assert.deepEqual(JSON.parse(await readFile(s.target,'utf8')),f.receipt);
 assert.deepEqual(await Promise.all(['research','drafts','learning-selection'].map(name=>readFile(path.join(s.root,'data',name,runId+'.json'),'utf8'))),inputs);assert.deepEqual((await readdir(path.join(s.root,'data'))).sort(),['check-diagnostics','drafts','learning-selection','research']);
 const changed=structuredClone(f.receipt);changed.failures[0].httpStatus=503;await writeFile(s.file,JSON.stringify(changed));await assert.rejects(importCheckDiagnostics({...s.args,expectedSha256:sha256(stableJSON(changed))}));assert.deepEqual(JSON.parse(await readFile(s.target,'utf8')),f.receipt);
});

test('import rejects foreign entries, symlinks, oversized or malformed records and altered original files',async t=>{
 for(const mutate of [async s=>writeFile(path.join(s.directory,'foreign.json'),'{}'),async s=>{await rm(s.file);await writeFile(path.join(s.directory,'foreign.json'),'{}');},async s=>{const actual=path.join(s.root,'actual.json');await writeFile(actual,await readFile(s.file));await rm(s.file);await symlink(actual,s.file);},async s=>writeFile(s.file,' '.repeat(CHECK_DIAGNOSTICS_MAX_BYTES+1)),async s=>writeFile(s.file,'{"invalid syntax"'),async s=>{const draft=JSON.parse(await readFile(path.join(s.root,'data','drafts',runId+'.json'),'utf8'));draft.rejected[0].reason='Changed after pinning.';await writeFile(path.join(s.root,'data','drafts',runId+'.json'),JSON.stringify(draft));},async s=>{const original=path.join(s.root,'data','learning-selection',runId+'.json'),elsewhere=path.join(s.root,'selection.json');await writeFile(elsewhere,await readFile(original));await rm(original);await symlink(elsewhere,original);}]){
  const f=await fixture(),s=await sandbox(t,f);await mutate(s);await assert.rejects(importCheckDiagnostics(s.args));await assert.rejects(lstat(s.target),{code:'ENOENT'});
 }
 const linked=await sandbox(t,await fixture()),alias=path.join(linked.root,'alias');await symlink(linked.directory,alias,'dir');await assert.rejects(importCheckDiagnostics({...linked.args,directory:alias}));
 const target=await sandbox(t,await fixture()),outside=path.join(target.root,'elsewhere');await mkdir(outside);await symlink(outside,path.join(target.root,'data','check-diagnostics'),'dir');await assert.rejects(importCheckDiagnostics(target.args));assert.deepEqual(await readdir(outside),[]);
});

test('the CLI uses only explicit expected pins and imports no checker or publication evidence',async t=>{
 const f=await fixture(),s=await sandbox(t,f);
 for(const name of ['lib','scripts'])await cp(new URL('../'+name,import.meta.url),path.join(s.root,name),{recursive:true});await mkdir(path.join(s.root,'public'));for(const name of ['schedule.js','cadence-config.js'])await cp(new URL('../public/'+name,import.meta.url),path.join(s.root,'public',name));await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),path.join(s.root,'node_modules'),'dir');await writeFile(path.join(s.root,'package.json'),'{"type":"module"}');await writeFile(path.join(s.root,'offline.mjs'),"globalThis.fetch=async()=>{throw new Error('No live calls are allowed in diagnostic tests.');};");
 const p=pins(f),env={PATH:process.env.PATH,NODE_OPTIONS:`--import=${path.join(s.root,'offline.mjs')}`,EXPECTED_CHECK_DIAGNOSTICS_SHA:options(f).expectedSha256,EXPECTED_DIAGNOSTIC_PHASE:phase,EXPECTED_DIAGNOSTIC_DRAFT_SHA:p.expectedDraftSha256,EXPECTED_RESEARCH_SHA:p.expectedResearchSha256,EXPECTED_LEARNING_SELECTION_SHA:p.expectedSelectionSha256};
 const invoke=extra=>spawnSync(process.execPath,['scripts/import-check-diagnostics.mjs',s.directory,runId],{cwd:s.root,env:{...env,...extra},encoding:'utf8'});
 const result=invoke();assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{runId,phase,imported:true,diagnosticOnly:true});assert.doesNotMatch(result.stdout,/robots.txt|sourceId|scoring|text/);
 for(const key of ['EXPECTED_CHECK_DIAGNOSTICS_SHA','EXPECTED_DIAGNOSTIC_PHASE','EXPECTED_DIAGNOSTIC_DRAFT_SHA','EXPECTED_RESEARCH_SHA','EXPECTED_LEARNING_SELECTION_SHA'])assert.notEqual(invoke({[key]:''}).status,0,key);
 assert.deepEqual((await readdir(path.join(s.root,'data'))).sort(),['check-diagnostics','drafts','learning-selection','research']);
});
