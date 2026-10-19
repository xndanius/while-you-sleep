import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {noveltyProfile,noveltyMatches,noveltyReasons,recentPublishedPosts,createNoveltyContext,noveltyAssessmentReasons,noveltyApprovalReasons,noveltyContextReasons} from '../lib/novelty.mjs';
import {deterministicCheck,verifyPublishedPost,checkApproval} from '../lib/validation.mjs';
import {candidateIdentity,sha256,stableJSON} from '../lib/storage.mjs';
import {privateArtifactReasons} from '../lib/privacy.mjs';

const now=new Date('2026-10-12T07:30:00Z'),publishedAt='2026-10-11T18:00:00Z';
const idea=(changes={})=>({id:'prior-1',title:'Triage a support inbox',productUrl:'https://alpha-kit.ai',promise:'Categorize incoming customer questions and draft replies.',whatItIs:'A small helpdesk loop.',whoPays:'Hypothesis: an online shop with recurring questions.',loop:['Read new support tickets.','Classify each message by topic.','Draft a reply for approval.'],publishedAt,...changes});
const dimensions=(post,previous)=>new Set(noveltyMatches(post,previous,{now}).map(match=>match.dimension));

test('the actual historical support posts are duplicates in both directions and remain valid historical records',async()=>{
 const a=JSON.parse(await readFile(new URL('../data/posts/e20bcacf021524725d3fc275.json',import.meta.url),'utf8'));
 const b=JSON.parse(await readFile(new URL('../data/posts/98b4f6281cc3de4ecdfa95f6.json',import.meta.url),'utf8'));
 for(const [post,prior] of [[a,b],[b,a]]){const match=dimensions(post,[prior]);assert.equal(match.has('product'),false);assert.equal(match.has('workflow'),true);assert.equal(match.has('customer'),true);}
 assert.equal(verifyPublishedPost(a),true);assert.equal(verifyPublishedPost(b),true);
});
test('real historical novelty context is privacy-safe and retains the exact semantic signals and frozen hash',async()=>{
 const posts=await Promise.all(['e20bcacf021524725d3fc275','98b4f6281cc3de4ecdfa95f6'].map(id=>readFile(new URL(`../data/posts/${id}.json`,import.meta.url),'utf8').then(JSON.parse)));
 const memory=createNoveltyContext(posts,{now});assert.equal(memory.version,1);assert.equal(memory.windowDays,14);assert.equal(memory.posts.length,2);assert.deepEqual(privateArtifactReasons(memory),[]);assert.equal(memory.postsSha256,sha256(stableJSON(memory.posts)));
 for(const entry of memory.posts){assert.equal(Object.hasOwn(entry,'profile'),false);assert.deepEqual(entry.noveltySignals,noveltyProfile(posts.find(post=>post.id===entry.id)));}
 const context={noveltyContractVersion:1,noveltyContext:memory};assert.deepEqual(noveltyContextReasons(context),[]);memory.posts[0].noveltySignals.workflowKeys.push('changed-after-freezing');assert.ok(noveltyContextReasons(context).length);
});
test('legacy frozen profile-named signals remain readable without changing their bytes or weakening bindings',()=>{
 const {context,check}=noveltyFixture();for(const post of context.noveltyContext.posts){post.profile=post.noveltySignals;delete post.noveltySignals;}context.noveltyContext.postsSha256=sha256(stableJSON(context.noveltyContext.posts));check.noveltyCheck.recentPostsSha256=context.noveltyContext.postsSha256;
 const before=stableJSON(context);assert.deepEqual(noveltyContextReasons(context),[]);assert.deepEqual(noveltyApprovalReasons(check,context),[]);assert.equal(stableJSON(context),before);assert.ok(privateArtifactReasons(context).length);
 const stale=structuredClone(check);stale.noveltyCheck.recentPostsSha256='0'.repeat(64);assert.ok(noveltyAssessmentReasons(stale,context).length);
});
test('a same specific customer is a duplicate even when products and workflows differ',()=>{
 const a=idea({title:'Review low stock',promise:'Find stock shortages.',loop:['Read item counts.','Flag products below stock limits.','Prepare a replenishment plan.']});
 const b=idea({id:'next',title:'Review supplier receipts',productUrl:'https://beta-kit.ai',whoPays:'Hypothesis: ecommerce merchants could pay.',promise:'Extract supplier receipt details.',loop:['Read receipts.','Extract expense fields.','Export expenses as CSV.']});
 const found=dimensions(b,[a]);assert.equal(found.has('customer'),true);assert.equal(found.has('workflow'),false);assert.equal(found.has('product'),false);
});
test('paraphrased support workflows are duplicates with different products and specific customers',()=>{
 const a=idea({whoPays:'Hypothesis: online shops.'});
 const b=idea({productUrl:'https://beta-kit.ai',title:'Prepare helpdesk responses',whoPays:'Hypothesis: municipal library managers.',promise:'Route helpdesk messages and compose answers.',loop:['Receive a helpdesk request.','Route it to its topic.','Compose a response and ask for approval.']});
 const found=dimensions(b,[a]);assert.equal(found.has('workflow'),true);assert.equal(found.has('customer'),false);assert.equal(found.has('product'),false);
});
test('specific customer aliases and meeting follow-up paraphrases are compared',()=>{
 const a=idea({title:'Summarize meetings',promise:'Turn meeting transcripts into action items.',loop:['Read a meeting transcript.','Summarize decisions.','Send the action items.'],whoPays:'Hypothesis: architectural practices.'});
 const b=idea({productUrl:'https://beta-kit.ai',title:'Draft meeting minutes',promise:'Record meeting decisions and follow-ups.',loop:['Read recorded meeting minutes.','Prepare a summary of decisions.','List follow ups for attendees.'],whoPays:'Hypothesis: architects.'});
 const found=dimensions(b,[a]);assert.equal(found.has('workflow'),true);assert.equal(found.has('customer'),true);
});
test('the same product is caught across homepage, documentation, subdomain and repository aliases',()=>{
 const a=idea({productUrl:'https://forgekit.ai/ai'});
 for(const productUrl of ['https://forgekit.ai/','https://docs.forgekit.ai/getting-started','https://github.com/company/forgekit/blob/main/README.md'])assert.equal(dimensions(idea({productUrl}),[a]).has('product'),true);
 const repo=idea({productUrl:'https://github.com/company/forgekit'});
 assert.equal(dimensions(idea({productUrl:'https://raw.githubusercontent.com/company/forgekit/main/README.md'}),[repo]).has('product'),true);
});
test('different products on shared hosts do not become one product family',()=>{
 for(const [a,b] of [['https://github.com/company/first-kit','https://github.com/company/second-kit'],['https://first-kit.vercel.app','https://second-kit.vercel.app'],['https://huggingface.co/spaces/company/first-kit','https://huggingface.co/spaces/company/second-kit']])assert.equal(dimensions(idea({productUrl:b}),[idea({productUrl:a})]).has('product'),false);
});
test('distinct public tenders, job requests and merchant requests retain item identities on shared hosts',()=>{
 for(const [a,b] of [['https://ted.europa.eu/en/notice/-/detail/721351-2026','https://ted.europa.eu/en/notice/-/detail/721352-2026'],['https://weworkremotely.com/remote-jobs/first-operations','https://weworkremotely.com/remote-jobs/second-operations'],['https://wordpress.org/support/topic/first-request/','https://wordpress.org/support/topic/second-request/']]){
  const left=noveltyProfile(idea({productUrl:a})),right=noveltyProfile(idea({productUrl:b}));assert.ok(left.productKeys.length);assert.ok(!left.productKeys.some(key=>right.productKeys.includes(key)));
  assert.deepEqual(noveltyProfile(idea({productUrl:a+'?utm_source=feed'})).productKeys,left.productKeys);
 }
});
test('different n8n template projects with different tasks and customers are not duplicates solely from the vendor host',()=>{
 const a=idea({productUrl:'https://n8n.io/workflows/101-receipt-extraction',title:'Extract receipt rows',promise:'Extract receipt details into a CSV.',whoPays:'Hypothesis: bookkeepers.',loop:['Read receipts.','Extract expense fields.','Export expenses as CSV.']});
 const b=idea({productUrl:'https://n8n.io/workflows/202-meeting-minutes',title:'Summarize meeting decisions',promise:'Turn meeting transcripts into action items.',whoPays:'Hypothesis: architectural practices.',loop:['Read a meeting transcript.','Summarize decisions.','Send action items to attendees.']});
 assert.deepEqual(noveltyMatches(b,[a],{now}),[]);
 assert.equal(dimensions(idea({productUrl:'https://betalist.com/startups/second-kit'}),[idea({productUrl:'https://betalist.com/startups/first-kit'})]).has('product'),false);
});
test('catalog item aliases retain stable template and startup identities without using the vendor domain',()=>{
 const template=idea({productUrl:'https://n8n.io/workflows/101-receipt-extraction'});
 for(const productUrl of ['https://www.n8n.io/workflows/101-receipt-extraction/?utm_source=feed','https://n8n.io/workflows/101-receipt-extraction-renamed'])assert.equal(dimensions(idea({productUrl}),[template]).has('product'),true);
 const startup=idea({productUrl:'https://betalist.com/startups/forgekit'});
 for(const productUrl of ['https://www.betalist.com/startups/forgekit/?utm_source=feed','https://forgekit.ai/'])assert.equal(dimensions(idea({productUrl}),[startup]).has('product'),true);
 assert.equal(dimensions(idea({productUrl:'https://docs.n8n.io/'}),[idea({productUrl:'https://n8n.io/ai'})]).has('product'),true);
});
test('generic AI automation, business and team language alone causes no semantic duplicate',()=>{
 const a=idea({title:'AI workflow helper',promise:'Use AI automation for a small business.',whoPays:'Hypothesis: small teams.',loop:['Read an input.','Run a model.','Review the output.']});
 const b=idea({title:'Another automation helper',productUrl:'https://beta-kit.ai',promise:'Build an AI workflow for a business.',whoPays:'Hypothesis: a small business team.',loop:['Read inputs.','Run AI models.','Review outputs.']});
 assert.deepEqual(noveltyMatches(b,[a],{now}),[]);
});
test('the 14-day boundary is inclusive; one millisecond older and future records are outside the memory',()=>{
 const cutoff=new Date(now.getTime()-14*86400000);
 const same=idea({productUrl:'https://beta-kit.ai'});
 assert.ok(noveltyReasons(same,[idea({publishedAt:cutoff.toISOString()})],{now}).length);
 assert.deepEqual(noveltyReasons(same,[idea({publishedAt:new Date(cutoff.getTime()-1).toISOString()})],{now}),[]);
 assert.deepEqual(recentPublishedPosts([idea({publishedAt:new Date(now.getTime()+1).toISOString()}),idea({publishedAt:'invalid'})],{now}),[]);
});
test('the publisher deterministic guard rejects a different product sharing customer or workflow',()=>{
 const post=idea({productUrl:'https://beta-kit.ai',sourceIds:['s1'],evidence:'A working product exists.',uncertainty:'Demand remains a hypothesis.',first24Hours:['Choose examples.','Build a draft.','Test review.']});delete post.publishedAt;
 post.id=post.candidateId=candidateIdentity(post);
 const reasons=deterministicCheck(post,[{id:'s1',url:post.productUrl}],[idea()],{noveltyNow:now});
 assert.ok(reasons.some(reason=>reason.includes('Duplicate within 14 days')&&reason.includes('workflow')));
 assert.ok(reasons.some(reason=>reason.includes('Duplicate within 14 days')&&reason.includes('customer')));
});

function noveltyFixture(previous=[idea()]){
 const context={noveltyContractVersion:1,noveltyContext:createNoveltyContext(previous,{now})};
 const comparison={distinct:true,closestPostId:previous.length?previous[0].id:null,reason:'A concrete distinct actor, task and buyer compared with the nearest recent post.'};
 const check={noveltyCheck:{recentPostsSha256:context.noveltyContext.postsSha256,windowDays:14,comparedPostCount:context.noveltyContext.posts.length,product:{...comparison},workflow:{...comparison},customer:{...comparison}}};return {context,check};
}
test('independent novelty approval binds the exact memory and all three actual nearest-post references',()=>{
 const {context,check}=noveltyFixture();assert.deepEqual(noveltyAssessmentReasons(check,context),[]);assert.deepEqual(noveltyApprovalReasons(check,context),[]);
 assert.ok(noveltyApprovalReasons({},context).length);
 const missing=structuredClone(check);delete missing.noveltyCheck.customer;assert.ok(noveltyApprovalReasons(missing,context).length);
 const partial=structuredClone(check);partial.noveltyCheck.comparedPostCount=0;assert.ok(noveltyApprovalReasons(partial,context).length);
 const stale=structuredClone(check);stale.noveltyCheck.recentPostsSha256='0'.repeat(64);assert.ok(noveltyApprovalReasons(stale,context).length);
 const invented=structuredClone(check);invented.noveltyCheck.workflow.closestPostId='invented';assert.ok(noveltyApprovalReasons(invented,context).length);
});
test('a verified duplicate verdict is a complete assessment but cannot approve publication',()=>{
 const {context,check}=noveltyFixture();check.noveltyCheck.customer.distinct=false;check.noveltyCheck.customer.reason='The same proposed online-shop customer appears in prior-1.';
 assert.deepEqual(noveltyAssessmentReasons(check,context),[]);assert.ok(noveltyApprovalReasons(check,context).some(reason=>reason.includes('duplicate customer')));
});
test('empty recent memory requires null references; legacy contexts retain their original schema',()=>{
 const {context,check}=noveltyFixture([]);assert.deepEqual(noveltyApprovalReasons(check,context),[]);
 check.noveltyCheck.product.closestPostId='invented';assert.ok(noveltyApprovalReasons(check,context).length);
 assert.deepEqual(noveltyApprovalReasons({},{}),[]);
});
test('frozen recent memory detects tampering and an invalid comparison date',()=>{
 const {context}=noveltyFixture();assert.deepEqual(noveltyContextReasons(context),[]);
 context.noveltyContext.posts[0].whoPays='Changed after freezing.';assert.ok(noveltyContextReasons(context).length);
 const invalid=noveltyFixture().context;invalid.noveltyContext.cutoff='2020-01-01T00:00:00Z';assert.ok(noveltyContextReasons(invalid).length);
});
test('checkApproval cannot publish an otherwise grounded post without required independent novelty approval',()=>{
 const source={id:'s1',text:'This public page describes a working extraction service. It exports approved rows to CSV. Human review remains required.'};
 const post={id:'new',sourceIds:['s1']},draft={runId:'new-run',posts:[post]};
 const {context,check}=noveltyFixture();Object.assign(context,{runId:draft.runId,sources:[source],deterministicResults:[{postId:post.id,reasons:[]}],draftSha256:sha256(stableJSON(draft)),sourceSnapshotSha256:sha256(stableJSON([source]))});
 const claims=[['working service','working extraction service'],['export supported','exports approved rows to CSV'],['review required','Human review remains required']].map(([claim,evidenceQuote])=>({claim,supported:true,sourceId:'s1',evidenceQuote}));
 const manifest={runId:draft.runId,draftSha256:context.draftSha256,sourceSnapshotSha256:context.sourceSnapshotSha256,checks:[{postId:post.id,pass:true,reasons:[],claimChecks:claims,...check}]};
 assert.equal(checkApproval(draft,context,manifest)[0].pass,true);
 delete manifest.checks[0].noveltyCheck;assert.equal(checkApproval(draft,context,manifest)[0].pass,false);
});
