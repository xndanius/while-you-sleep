import test from 'node:test';
import assert from 'node:assert/strict';
import {DEMAND_SOURCE_CATALOG,sourceRole,sourceSegments,sourceDemandKind,parseDemandSourcePage,fetchDemandEvidence,demandTaskCount,demandEvidenceFingerprint,DEMAND_TASK_EXTRACTOR_VERSION} from '../lib/demand-sources.mjs';
import {sourceSeedCatalog,normalizeSourceDefinition,parseSourcePage,validateSource} from '../lib/research.mjs';
import {sourceDefinitionReasons,SOURCE_POLICY} from '../lib/source-registry.mjs';
import {admissionDecision} from '../scripts/source-registry.mjs';
import {hash,canonicalURL} from '../lib/storage.mjs';
import {privateArtifactReasons} from '../lib/privacy.mjs';
import {publicDemandFetchOptions,TED_SEARCH_FIELDS} from '../lib/public-demand-feeds.mjs';

const now='2026-10-12T11:35:00.000Z';
const job=()=>({id:'31578015',headline:'Administrator for Alice Example',occupation:{label:'Administratör'},salary_type:{concept_id:'oG8G_9cW_nRf',label:'Fixed salary'},publication_date:'2026-10-09T14:18:45',application_deadline:'2026-11-01T00:00:00',employer:{name:'Private Person',email:'private@example.org',phone:'0701234567'},application_contacts:[{name:'Alice Example',email:'alice@example.org'}],description:{text:'Du arbetar med registrering av fakturor och administrativa rapporter. Du kontaktar Alice Example för frågor om uppgiften. Du kan ringa 0701234567 eller maila alice@example.org. Du hanterar patientdata för John Example. Du utvecklar mjukvara och system.'}});
const tender=()=>({id:'8c5c952b-376a-46d4-8635-c3fba0288d03-917384',date:'2026-10-12T10:56:01+01:00',tag:['tender'],buyer:{name:'Alice Example',contactPoint:{email:'alice@example.org'}},tender:{title:'Alice Example requires mailing help',description:'Private Person alice@example.org 0701234567',status:'active',classification:{scheme:'CPV',id:'79571000',description:'Mailing services Alice Example'},value:{amount:999999,currency:'GBP'}}});
function page(def,data){return {url:def.url,text:JSON.stringify(data),fetchedAt:now,status:200,contentType:'application/json',maxBytes:2000000,truncated:false,redirects:[],robots:[{origin:new URL(def.url).origin,robotsUrl:new URL('/robots.txt',def.url).toString(),status:404,state:'missing',contentType:'text/plain',fetchedAt:now,evaluatedUrl:def.url,allowed:true}]};}

test('fixed public demand feeds keep licensed scopes without changing the four-field definition schema',()=>{
 assert.equal(DEMAND_SOURCE_CATALOG.length,10);assert.equal(SOURCE_POLICY.maxDiscoveriesPerDay,3);
 for(const def of DEMAND_SOURCE_CATALOG){assert.equal(sourceRole(def),'demand');assert.ok(sourceSegments(def).length);assert.ok(['paid_job','public_tender','community_request'].includes(sourceDemandKind(def)));assert.ok(def.termsUrl.startsWith('https://'));assert.ok(sourceSeedCatalog.some(source=>source.id===def.id));assert.deepEqual(sourceDefinitionReasons(def),[]);assert.deepEqual(Object.keys(normalizeSourceDefinition(def)).sort(),['id','kind','name','url']);}
 for(const forged of [{...DEMAND_SOURCE_CATALOG[0],url:'https://other.example.org/'},{...DEMAND_SOURCE_CATALOG[2],url:DEMAND_SOURCE_CATALOG[2].url+'&profile=true'},{...DEMAND_SOURCE_CATALOG[2],id:'forged'}]){assert.equal(sourceRole(forged),'building');assert.throws(()=>normalizeSourceDefinition(forged),/definition|ID/);assert.ok(sourceDefinitionReasons(forged).length);}
 assert.equal(sourceRole({kind:'hn',url:'https://hn.algolia.com/api/v1/search',role:'demand'}),'building');assert.deepEqual(sourceSegments({kind:'hn',url:'https://hn.algolia.com/api/v1/search'}),[]);
});

test('paid administration task excerpts omit contacts, names, employer profiles, salaries and all arbitrary fields',()=>{
 const def=DEMAND_SOURCE_CATALOG[2],item=parseDemandSourcePage(def,page(def,{hits:[job()]}))[0];
 assert.equal(item.segment,'professional_services');assert.equal(item.demandKind,'paid_job');assert.equal(item.registrySourceId,def.id);assert.equal(item.title,'Paid administrator role');assert.equal(item.postedAt,'2026-10-09');assert.equal(item.demandEvidence.paid,true);assert.equal(item.demandEvidence.paymentBasis,'fixed monthly, weekly or hourly salary');
 assert.match(item.text,/Du arbetar med registrering av fakturor och administrativa rapporter/);
 assert.doesNotMatch(JSON.stringify(item),/Alice|Private Person|John|@|0701234567|patientdata|mjukvara/);assert.ok(item.text.length<=1200);assert.equal(item.employer,undefined);assert.equal(item.application_contacts,undefined);assert.equal(item.description,undefined);
 assert.equal(item.id,hash(item.url));assert.equal(item.url,'https://jobsearch.api.jobtechdev.se/ad/31578015');assert.match(item.text,/does not prove anyone buys an AI tool/);
});

test('only salaried, open and nontechnical roles in the actual selected segment pass the job adapter',()=>{
 const def=DEMAND_SOURCE_CATALOG[2];
 for(const change of [row=>row.salary_type={},row=>row.removed=true,row=>row.application_deadline='2026-10-01',row=>row.occupation.label='Software developer',row=>row.headline='IT-system administrator',row=>row.id='person/profile',row=>row.occupation.label='Läkare']){const row=job();change(row);assert.throws(()=>parseDemandSourcePage(def,page(def,{hits:[row]})),/No current paid nontechnical/);}
 const health=DEMAND_SOURCE_CATALOG[3],medical=job();medical.occupation.label='Medicinsk sekreterare';medical.headline='Medicinsk sekreterare';assert.equal(parseDemandSourcePage(health,page(health,{hits:[medical]}))[0].segment,'health_admin');
 const school=DEMAND_SOURCE_CATALOG[4],education=job();education.occupation.label='Skolassistent';education.headline='Skoladministratör';assert.equal(parseDemandSourcePage(school,page(school,{hits:[education]}))[0].segment,'education');
 assert.throws(()=>parseDemandSourcePage(health,page(health,{hits:[job()]})),/No current paid nontechnical/);
});

test('literal task bullets take the bounded excerpt slots ahead of generic introductions',()=>{
 const def=DEMAND_SOURCE_CATALOG[2],row=job();
 const tasks=['Hantera dokumentation, registrering och arkivering','Sammanställa rapporter, statistik och olika typer av underlag','Uppdatera och administrera interna system'];
 row.description.text=['Du är en strukturerad administratör med god servicekänsla.','Som administratör arbetar du i en viktig stödjande roll.','Vi söker dig som har erfarenhet av administration.',...tasks.map(line=>'• '+line),'Registrera dokument för Alice Example och skicka till alice@example.org.','Registrera dokument på telefon 0701234567.','Compile invoice records for human review.'].join('\n');
 const item=parseDemandSourcePage(def,page(def,{hits:[row]}))[0];
 assert.deepEqual(item.taskExcerpts,tasks);assert.equal(demandTaskCount(item),3);
 assert.ok(tasks.every(line=>item.text.includes(line)&&row.description.text.includes(line)));
 assert.doesNotMatch(JSON.stringify(item),/Alice|@|0701234567|servicekänsla/);assert.ok(item.text.length<=1200);
 assert.equal(demandTaskCount({...item,taskExcerpts:['Invented invoice task not present in the source.']}),0);
});

test('task excerpts never truncate a statement or remove the human-work disclaimer to fit the budget',()=>{
 const def=DEMAND_SOURCE_CATALOG[2],row=job();
 row.description.text=Array.from({length:3},(_,i)=>'Registrera dokument och sammanställa rapporter '+('för granskning '.repeat(18))+['dagligen','veckovis','månadsvis'][i]).join('\n');
 const item=parseDemandSourcePage(def,page(def,{hits:[row]}))[0];
 assert.ok(item.taskExcerpts.length>=1);assert.ok(item.text.length<=1200);
 assert.ok(item.taskExcerpts.every(line=>row.description.text.includes(line)&&item.text.includes(line)));
 assert.ok(item.text.endsWith('A paid staff vacancy is demand for human work; it does not prove anyone buys an AI tool.'));
});

test('official service tenders whitelist CPV categories and active tender requests without buyer/contact/free-text or payment claims',()=>{
 const def=DEMAND_SOURCE_CATALOG[0],item=parseDemandSourcePage(def,page(def,{releases:[tender()]}))[0];
 assert.equal(item.title,'Public tender: Mailing services');assert.equal(item.segment,'public_sector');assert.equal(item.demandKind,'public_tender');assert.equal(item.demandEvidence.status,'active');assert.equal(item.demandEvidence.classificationCode,'79571000');assert.equal(item.postedAt,'2026-10-12T09:56:01.000Z');assert.match(item.text,/does not prove a completed payment/);
 assert.doesNotMatch(JSON.stringify(item),/Alice|Private Person|@|0701234567|999999/);assert.equal(item.buyer,undefined);assert.equal(item.tender,undefined);
 for(const change of [row=>row.tender.status='cancelled',row=>row.tag=['award'],row=>row.tender.classification.id='72000000',row=>row.tender.classification.id='45000000',row=>row.tender.classification.scheme='other',row=>row.id='bad']){const row=tender();change(row);assert.throws(()=>parseDemandSourcePage(def,page(def,{releases:[row]})),/No current paid nontechnical/);}
 const ft=DEMAND_SOURCE_CATALOG[1],r=tender();r.id='095976-2026';const second=parseDemandSourcePage(ft,page(ft,{releases:[r]}))[0];assert.equal(second.url,'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages/095976-2026');
});

test('demand adapters reject incomplete, foreign-origin and malformed responses rather than treating them as buying intent',()=>{
 const def=DEMAND_SOURCE_CATALOG[2],good=page(def,{hits:[job()]});
 for(const changed of [{...good,truncated:true},{...good,url:'https://foreign.example.org/feed'},{...good,text:'{"hits":'}])assert.throws(()=>parseDemandSourcePage(def,changed));
 assert.throws(()=>parseDemandSourcePage({...def,url:def.url+'&other=true'},good),/exact vetted/);
 const many=Array.from({length:30},(_,i)=>({...job(),id:String(30000000+i)}));assert.equal(parseSourcePage(def,page(def,{hits:many})).length,20);
});

test('fresh demand re-fetch reconstructs privacy-safe authority from the trusted feed and exact official notice ID',async()=>{
 const def=DEMAND_SOURCE_CATALOG[2],original=parseDemandSourcePage(def,page(def,{hits:[job()]}))[0];let request;
 const fresh=await fetchDemandEvidence({...original,text:'Model claims customers paid for its AI tool.',role:'building'},{definition:def,fetchPage:async(url,options)=>{request={url,options};return {...page(def,job()),url,robots:[{...page(def,job()).robots[0],evaluatedUrl:url}]};}});
 assert.equal(fresh.role,'demand');assert.equal(fresh.id,original.id);assert.equal(fresh.registrySourceId,def.id);assert.equal(fresh.verifiedAt,now);assert.doesNotMatch(fresh.text,/Model claims/);assert.doesNotMatch(JSON.stringify(fresh),/Alice|Private Person|@/);assert.deepEqual(request.options,{maxBytes:2000000,complete:true});
 assert.equal(fresh.productUrl,original.url);assert.equal(fresh.enriched,true);assert.equal(fresh.evidenceKind,'demand-notice');assert.deepEqual(fresh.evidenceFetch,{maxBytes:2000000,complete:true});
 for(const altered of [{...original,registrySourceId:'forged'},{...original,url:'https://foreign.example.org/ad/31578015'},{...original,url:original.url+'?contact=true'},{...original,id:'forged'}])await assert.rejects(fetchDemandEvidence(altered,{definition:def}),/origin|scope/);
 await assert.rejects(fetchDemandEvidence(original,{definition:def,fetchPage:async url=>({...page(def,job()),url,robots:[{allowed:false}]})}),/public guards/);
 await assert.rejects(fetchDemandEvidence(original,{definition:def,fetchPage:async url=>({...page(def,{...job(),id:'31578016'}),url})}),/No current paid nontechnical/);
});

test('normal guarded source admission recognizes the new adapters and retains old admission invariants',async()=>{
 const def=DEMAND_SOURCE_CATALOG[2],data=page(def,{hits:[job()]});const result=await validateSource(def,{now,fetchPage:async()=>data});
 assert.equal(result.eligible,true);assert.equal(result.validation.itemCount,1);assert.equal(admissionDecision(result,normalizeSourceDefinition(def)),true);assert.equal(result.sampleItems[0].role,'demand');
 const blocked=await validateSource(def,{now,fetchPage:async()=>({...data,robots:[{...data.robots[0],allowed:false}]})});assert.equal(blocked.eligible,false);assert.equal(blocked.sampleItems.length,0);assert.equal(admissionDecision(blocked,normalizeSourceDefinition(def)),false);
 assert.equal(canonicalURL(result.sampleItems[0].url),result.sampleItems[0].url);
});


test('real task forms and fixed software names survive while recruitment and private names stay out',()=>{
 const def=DEMAND_SOURCE_CATALOG[2],row=job();
 const tasks=['Föra in tidrapporter i Excel och säkerställa korrekthet och noggrannhet','säkerställa att arbetsorder är uppdaterade och avslutas korrekt','kvalitetssäkra underlag och skapa ett effektivt faktureringsflöde'];
 row.description.text=['Vi söker dig som har erfarenhet av administration.','Du har erfarenhet av schemaplanering och fakturering.','Vi har skyldighet att kontrollera belastningsregistret.',...tasks,'Du registrerar dokument för Alice Example.','Föra in tidrapporter åt Private Person i Excel.','Registrera dokument på Main Street.'].join('\n');
 const item=parseDemandSourcePage(def,page(def,{hits:[row]}))[0];
 assert.deepEqual(item.taskExcerpts,tasks);assert.equal(demandTaskCount(item),3);assert.equal(item.taskExcerptVersion,DEMAND_TASK_EXTRACTOR_VERSION);
 assert.ok(tasks.every(line=>row.description.text.includes(line)));assert.doesNotMatch(item.text,/Alice|Private|Main|erfarenhet|belastnings/);
 const other=job();other.description.text='Du registrerar elever och böcker i vårt utlåningssystem.\nI ditt arbete kommer du att hantera arkivering och dokument.\nArbetsuppgifterna omfattar registrering av inkommande ärenden.';
 const preserved=parseDemandSourcePage(def,page(def,{hits:[other]}))[0];assert.equal(preserved.taskExcerpts.length,3);assert.equal(demandTaskCount(preserved),3);
});

test('demand evidence identity ignores fetch timestamps but changes when a literal task changes',()=>{
 const def=DEMAND_SOURCE_CATALOG[2],item=parseDemandSourcePage(def,page(def,{hits:[job()]}))[0],fingerprint=demandEvidenceFingerprint(item);
 assert.match(fingerprint,/^[a-f0-9]{64}$/);assert.equal(demandEvidenceFingerprint({...item,fetchedAt:'2026-10-14T00:00:00.000Z',verifiedAt:'2026-10-14T00:00:00.000Z',taskExcerptVersion:999}),fingerprint);
 assert.notEqual(demandEvidenceFingerprint({...item,text:item.text+' A changed public task.'}),fingerprint);assert.equal(demandEvidenceFingerprint({...item,role:'building'}),null);
});

const liveDay='2026-10-19T08:30:00.000Z';
const publicPage=(def,body)=>({...page(def,{}),text:body,fetchedAt:liveDay,contentType:def.kind==='ted-service-demand'?'application/json':'application/rss+xml'});
const rss=(url,description,{title='Operations role',published='Mon, 19 Oct 2026 07:00:00 GMT'}={})=>`<?xml version="1.0"?><rss version="2.0"><channel><item><title>${title}</title><link>${url}</link><pubDate>${published}</pubDate><creator>Private Person</creator><description><![CDATA[${description}]]></description></item></channel></rss>`;
test('English public job feeds retain concrete literal tasks while omitting contact and recruitment data',()=>{
 const def=DEMAND_SOURCE_CATALOG.find(source=>source.kind==='wwr-demand'),url='https://weworkremotely.com/remote-jobs/example-operations';
 const task='Process incoming invoices and prepare weekly payment reports';
 const raw=rss(url,`<ul><li>${task}</li><li>Manage the customer inbox and resolve refund requests</li><li>Send your resume to private@example.org</li><li>Coordinate documents with Alice Example every day</li></ul>`);
 const item=parseDemandSourcePage(def,publicPage(def,raw))[0];
 assert.ok(item.taskExcerpts.includes(task));assert.ok(item.taskExcerpts.includes('Manage the customer inbox and resolve refund requests'));assert.equal(demandTaskCount(item),2);assert.equal(item.demandEvidence.paid,true);assert.equal(item.demandKind,'paid_job');assert.ok(item.text.length<=1200);assert.deepEqual(privateArtifactReasons(item),[]);assert.doesNotMatch(JSON.stringify(item),/Private Person|Alice|resume|@/);
 assert.throws(()=>parseDemandSourcePage(def,publicPage(def,rss(url,`<p>${task}</p>`,{title:'Senior Software Engineer'}))),/No current concrete/);
});
test('merchant feed requests establish a public problem without inventing willingness to pay or copying author identity',()=>{
 const def=DEMAND_SOURCE_CATALOG.find(source=>source.kind==='woocommerce-demand'),url='https://wordpress.org/support/topic/repeated-invoice-export/';
 const task='I need to export paid orders into an invoice spreadsheet every week';
 const item=parseDemandSourcePage(def,publicPage(def,rss(url,`<p>${task}</p><p>My email is private@example.org</p>`)))[0];
 assert.equal(item.segment,'ecommerce');assert.equal(item.demandKind,'community_request');assert.equal(item.demandEvidence.paid,undefined);assert.ok(item.text.includes(task));assert.match(item.text,/willingness to pay.*remain hypotheses/);assert.deepEqual(privateArtifactReasons(item),[]);assert.equal(item.creator,undefined);
});
test('TED competition records retain fresh task descriptions and refuse results, expired deadlines and incomplete searches',()=>{
 const def=DEMAND_SOURCE_CATALOG.find(source=>source.kind==='ted-service-demand'),row={'publication-number':'721351-2026','publication-date':'2026-10-19+02:00','notice-type':'cn-standard','classification-cpv':['79500000'],'description-proc':{eng:'Provide document processing and weekly administration reports.'},'notice-title':{eng:'Public document administration services'},'deadline-date-lot':['2026-11-10+02:00'],buyer:{email:'private@example.org'}};
 const item=parseDemandSourcePage(def,publicPage(def,JSON.stringify({notices:[row],timedOut:false})))[0];assert.equal(item.url,'https://ted.europa.eu/en/notice/-/detail/721351-2026');assert.equal(item.demandEvidence.status,'active');assert.equal(item.postedAt,'2026-10-19');assert.ok(item.taskExcerpts.some(line=>row['description-proc'].eng.includes(line)&&line.includes('document processing and weekly administration reports')));assert.ok(demandTaskCount(item)>0);assert.deepEqual(privateArtifactReasons(item),[]);assert.equal(item.buyer,undefined);
 for(const changed of [{notices:[row],timedOut:true},{notices:[{...row,'notice-type':'can-standard'}]},{notices:[{...row,'deadline-date-lot':['2026-10-01Z']}]},{notices:[{...row,'deadline-date-lot':[]}]},{notices:[{...row,'publication-date':'2020-01-01Z'}]}])assert.throws(()=>parseDemandSourcePage(def,publicPage(def,JSON.stringify(changed))));
});
test('only the fixed anonymous TED endpoint receives a POST and redirects/robots remain GET requests',async()=>{
 const def=DEMAND_SOURCE_CATALOG.find(source=>source.kind==='ted-service-demand'),calls=[],fetchImpl=async(url,init)=>{calls.push({url:String(url),init});return {status:200};};
 const options=publicDemandFetchOptions(def,{fetchImpl,maxBytes:2000000,complete:true},'721351-2026');await options.fetchImpl(new URL(def.url),{method:'GET',headers:{'user-agent':'test'}});await options.fetchImpl('https://api.ted.europa.eu/robots.txt',{method:'GET',headers:{}});
 assert.equal(calls[0].init.method,'POST');const body=JSON.parse(calls[0].init.body);assert.equal(body.query,'publication-number=721351-2026');assert.equal(body.checkQuerySyntax,false);assert.deepEqual(body.fields,[...TED_SEARCH_FIELDS]);assert.equal(calls[1].init.method,'GET');assert.equal(calls[1].init.body,undefined);
 assert.throws(()=>publicDemandFetchOptions({...def,url:'https://other.example.org/'},{fetchImpl}),/exact public search/);assert.throws(()=>publicDemandFetchOptions(def,{fetchImpl},'injected OR notice'),/exact public search/);
});
test('public demand checker refetch reconstructs the exact advertised feed item and discards writer text',async()=>{
 const def=DEMAND_SOURCE_CATALOG.find(source=>source.kind==='wwr-demand'),url='https://weworkremotely.com/remote-jobs/example-operations',raw=rss(url,'<p>Process incoming invoices and prepare weekly payment reports</p>'),data=publicPage(def,raw),original=parseDemandSourcePage(def,data)[0];let request;
 const fresh=await fetchDemandEvidence({...original,text:'Invented customer payments'},{definition:def,fetchPage:async(requested,options)=>{request={requested,options};return data;}});
 assert.equal(request.requested,def.url);assert.equal(request.options.complete,true);assert.equal(fresh.url,url);assert.equal(fresh.verifiedAt,liveDay);assert.doesNotMatch(fresh.text,/Invented/);assert.deepEqual(privateArtifactReasons(fresh),[]);
 await assert.rejects(fetchDemandEvidence({...original,url:'https://other.example.org/remote-jobs/fake'},{definition:def,fetchPage:async()=>data}),/fixed public item scope/);
 await assert.rejects(fetchDemandEvidence(original,{definition:def,fetchPage:async()=>({...data,robots:[{allowed:false}]})}),/public guards/);
 await assert.rejects(fetchDemandEvidence(original,{definition:def,fetchPage:async()=>publicPage(def,rss('https://weworkremotely.com/remote-jobs/different','<p>Process incoming invoices and prepare weekly payment reports</p>'))}),/No current concrete/);
});
