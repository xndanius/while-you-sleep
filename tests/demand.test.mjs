import test from 'node:test';
import assert from 'node:assert/strict';
import {SEGMENTS,eligibleSegments,publicationMixReasons,classifyPublishedSegment,createDemandContext,demandContextHash,demandContextReasons,demandEvidenceReasons,demandAssessmentReasons,demandApprovalReasons} from '../lib/demand.mjs';
import {noveltyMatches} from '../lib/novelty.mjs';
import {checkerOutputSchema} from '../lib/checker-output.mjs';
import {verifyPublishedPost} from '../lib/validation.mjs';
import {readFile} from 'node:fs/promises';

const at='2026-10-12T11:00:00.000Z';
const post=(id,segment,date=at)=>({id,segment,publishedAt:date,demandContractVersion:1,checker:{demandCheck:{supported:true}}});
function fixture(){
 const source={id:'demand-one',url:'https://public.example.org/notice/one',text:'Public tender: Filing services. The requested service includes organizing and cataloguing existing office records. The active notice requests a paid administrative service.',role:'demand',registrySourceId:'feed-one',demandKind:'public_tender',demandMetadataVersion:1,verifiedAt:at,demandEvidence:{status:'active'}};
 const registrySources=[{id:'feed-one',url:'https://public.example.org/feed',kind:'official',role:'demand',demandKind:'public_tender',segments:['public_sector']}],authorizedSources=[{sourceId:source.id,registrySourceId:'feed-one',url:source.url,role:'demand',demandKind:'public_tender',segments:['public_sector']}];
 const demandContext=createDemandContext({registrySources,authorizedSources,posts:[],selectedSegment:'public_sector'}),context={createdAt:at,demandContractVersion:1,demandContext,demandContextSha256:demandContextHash(demandContext),sources:[source]};
 const candidate={id:'new',title:'Organize public office records',productUrl:source.url,segment:'public_sector',sourceIds:[source.id],demandEvidence:{kind:'public_tender',sourceIds:[source.id],chore:'Organize and catalogue existing office records.',evidenceQuote:'organizing and cataloguing existing office records'}};
 const check={demandCheck:{demandContextSha256:context.demandContextSha256,supported:true,segment:candidate.segment,sourceId:source.id,kind:'public_tender',chore:candidate.demandEvidence.chore,evidenceQuote:candidate.demandEvidence.evidenceQuote,reason:'An active public notice requests the stated office-record task; AI purchase and completed payment remain unproved.',noPersonalData:true}};
 return {source,candidate,context,check};
}
test('all nine fixed segments exist and fixed warm-up capacities permit a first nontechnical post',()=>{
 assert.equal(SEGMENTS.length,9);assert.equal(new Set(SEGMENTS).size,9);assert.equal(eligibleSegments([]).length,9);assert.deepEqual(publicationMixReasons('education',[]),[]);
 const five=Array.from({length:5},(_,i)=>post('p'+i,'education'));assert.deepEqual(publicationMixReasons('education',five),[]);assert.ok(publicationMixReasons('education',[...five,post('six','education')]).length);
});
test('AI quota includes the candidate, protects against legacy unknowns, and recovers as history shifts',()=>{
 assert.ok(publicationMixReasons('ai_software_builders',[post('one','ai_software_builders')]).length);
 const unknown={id:'unclassified',publishedAt:at};assert.ok(publicationMixReasons('ai_software_builders',[unknown]).length);
 const newer=Array.from({length:9},(_,i)=>post('new-'+i,i%2?'education':'professional_services',new Date(Date.parse(at)+i*1000).toISOString()));
 assert.deepEqual(publicationMixReasons('ai_software_builders',[{...unknown,publishedAt:'2026-10-10T10:00:00Z'},...newer]),[]);
});
test('segment quota counts exactly latest19 plus candidate, not a short-sample percentage',()=>{
 const same=Array.from({length:6},(_,i)=>post('s'+i,'education',new Date(Date.parse(at)+i*1000).toISOString()));assert.ok(publicationMixReasons('education',same).length);
 const other=Array.from({length:19},(_,i)=>post('o'+i,'local_services',new Date(Date.parse(at)+100000+i*1000).toISOString()));assert.deepEqual(publicationMixReasons('education',[...same,...other]),[]);
});
test('legacy buyer hypotheses remain transparent classifications without retrospective demand approval',async()=>{
 for(const [id,segment] of [['e20bcacf021524725d3fc275','ecommerce'],['1b30245f8580f86bcc4685c8','ai_software_builders']]){
  const value=JSON.parse(await readFile(new URL('../data/posts/'+id+'.json',import.meta.url),'utf8'));assert.equal(verifyPublishedPost(value),true);assert.deepEqual(classifyPublishedSegment(value),{segment,classification:'legacy_buyer_hypothesis',demandVerified:false});
 }
});
test('literal attached demand evidence and the fresh independent verdict can pass',()=>{
 const {source,candidate,context,check}=fixture();assert.deepEqual(demandContextReasons(context),[]);assert.deepEqual(demandEvidenceReasons(candidate,[source],{required:true,context}),[]);assert.deepEqual(demandApprovalReasons(check,candidate,context),[]);
});
test('writer-supplied demand role cannot turn building media into customer evidence',()=>{
 const {source,candidate,context}=fixture();context.demandContext.authorizedSources[0].role='building';context.demandContext.registrySources[0].role='building';context.demandContext.registrySha256=demandContextHash(context.demandContext.registrySources);context.demandContextSha256=demandContextHash(context.demandContext);
 source.role='demand';assert.ok(demandEvidenceReasons(candidate,[source],{required:true,context}).some(reason=>reason.includes('building media')));
});
test('wrong signal kind, fabricated quote, tool identity and selected-segment relabeling are rejected',()=>{
 const {source,candidate,context}=fixture();
 for(const change of [{segment:'education'},{productUrl:'https://tool.example.org'},{demandEvidence:{...candidate.demandEvidence,kind:'paid_job'}},{demandEvidence:{...candidate.demandEvidence,evidenceQuote:'A thousand paying AI customers already use this.'}}])assert.ok(demandEvidenceReasons({...candidate,...change},[source],{required:true,context}).length);
});
test('independent demand decision binds complete frozen authority, exact chore and fresh literal quote',()=>{
 const {candidate,context,check}=fixture();
 for(const change of [{demandContextSha256:'0'.repeat(64)},{sourceId:'unattached'},{chore:'Invented purchase'},{evidenceQuote:'Fictional paying users and revenue'}])assert.ok(demandApprovalReasons({demandCheck:{...check.demandCheck,...change}},candidate,context).length);
 assert.ok(demandApprovalReasons({},candidate,context).length);
});
test('supported false is an examined rejection; privacy false cannot approve',()=>{
 const {candidate,context,check}=fixture();check.demandCheck.supported=false;assert.deepEqual(demandAssessmentReasons(check,candidate,context),[]);assert.ok(demandApprovalReasons(check,candidate,context).length);
 check.demandCheck.supported=true;check.demandCheck.noPersonalData=false;assert.ok(demandApprovalReasons(check,candidate,context).length);
});
test('stale or absent adapter stamp and inactive demand cannot approve even with HTTP-shaped evidence',()=>{
 const {source,candidate,context,check}=fixture();source.verifiedAt='2020-01-01T00:00:00Z';assert.ok(demandApprovalReasons(check,candidate,context).length);source.verifiedAt=at;source.demandEvidence.status='cancelled';assert.ok(demandApprovalReasons(check,candidate,context).length);
});
test('no demand authority cannot complete a new empty assessment; legacy contexts retain their schema',()=>{
 const demandContext=createDemandContext(),context={demandContractVersion:1,demandContext,demandContextSha256:demandContextHash(demandContext)};assert.ok(demandContextReasons(context).length);assert.deepEqual(demandContextReasons({}),[]);
});
test('contacts and profile details cannot be used as an attached demand quote',()=>{
 const {source,candidate,context}=fixture();const privateText='Contact person@example.invalid for organizing and cataloguing records.';source.text=privateText;candidate.demandEvidence.evidenceQuote=privateText;assert.ok(demandEvidenceReasons(candidate,[source],{required:true,context}).some(reason=>reason.includes('contact')));
});
test('strict checker JSON schema requires demand proof only on new contexts',()=>{
 const {candidate,context}=fixture();Object.assign(context,{runId:'test',draftSha256:'a'.repeat(64),sourceSnapshotSha256:'b'.repeat(64),scoringPolicy:{policySha256:'c'.repeat(64)}});
 const schema=checkerOutputSchema({posts:[candidate]},context),fields=schema.properties.manifest.anyOf[1].properties.checks.items;
 assert.ok(fields.required.includes('demandCheck'));assert.equal(fields.properties.demandCheck.properties.demandContextSha256.enum[0],context.demandContextSha256);
 const old=checkerOutputSchema({posts:[candidate]},{...context,demandContractVersion:null});assert.equal(old.properties.manifest.anyOf[1].properties.checks.items.required.includes('demandCheck'),false);
});
test('distinct official notices do not collapse into a government catalog product identity',()=>{
 const base={id:'old',publishedAt:at,title:'Organize invoices',promise:'Review invoice totals.',whoPays:'Hypothesis: bookkeepers.',loop:['Read invoices','Extract totals','Check arithmetic']},newer={title:'Schedule school rooms',promise:'Prepare room allocations.',whoPays:'Hypothesis: school administrators.',loop:['Read room availability','Check timetable conflicts','Prepare room allocations']};
 for(const [a,b] of [['https://jobsearch.api.jobtechdev.se/ad/101','https://jobsearch.api.jobtechdev.se/ad/102'],['https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages/000101-2026','https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages/000102-2026']])assert.equal(noveltyMatches({...newer,productUrl:b},[{...base,productUrl:a}],{now:new Date(at)}).some(match=>match.dimension==='product'),false);
});
