import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { XMLParser,XMLValidator } from 'fast-xml-parser';
import jpeg from 'jpeg-js';
import { LINKEDIN_PAGE_URL,publicPostURL,rssTitle,rssDescription,metaDescription,renderPostPage,writeSiteArtifacts } from '../lib/site-artifacts.mjs';
import { slotPresentation,currentDaySlots } from '../public/slot-display.js';

const baseURL='https://example.test/while-you-sleep';
const post=(id='one',publishedAt='2026-10-11T05:20:00.000Z')=>({id,publishedAt,title:'Ideas & evidence <checked>',promise:'A useful promise & a clear limit.',whatItIs:'The complete description, including <untrusted> text.',whoPays:'Teams who need a small tool.',loop:['Research & gather','Check <claims>','Publish'],evidence:'An attributed observation with no invented numbers.',uncertainty:'Unknown adoption and reliability.',first24Hours:['Build a tiny form.','Test it with one real user.'],sources:[{title:'The maker & product',url:'https://example.org/product?a=one&b=two',publisher:'Example'},{title:'Never execute',url:'javascript:alert(1)'}]});
const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false});
const relayMarkup=/[()[\]{}<>@#*_~|\\]/u;

test('LinkedIn description has three plaintext paragraphs and up to three numbered steps',()=>{
  const content={...post(),first24Hours:['Build a tiny form.','Test it with one real user.','Record the result.','This fourth step is not relayed.']};
  const description=rssDescription(content),paragraphs=description.split('\n\n');
  assert.equal(paragraphs.length,3);
  assert.equal(paragraphs[0],content.promise);
  assert.equal(paragraphs[1],'Who might pay: Hypothesis: '+content.whoPays);
  assert.equal(paragraphs[2],'First 24 hours:\n1. Build a tiny form.\n2. Test it with one real user.\n3. Record the result.');
  assert.ok(description.length<=1000);
  assert.doesNotMatch(description,/Sources on the page|fourth step|\r|\n\n\n/);
});

test('existing buyer labels normalize to one explicit hypothesis without changing the website body',()=>{
  for(const buyer of ['Teams who need a small tool.','Hypothesis: Teams who need a small tool.','Who pays: Hypothesis: Teams who need a small tool.','Hypothesis: Hypothesis: Teams who need a small tool.','Who might pay: Hypothesis: Teams who need a small tool.']){
    const content={...post(),whoPays:buyer};
    const paragraph=rssDescription(content).split('\n\n')[1];
    assert.equal(paragraph,'Who might pay: Hypothesis: Teams who need a small tool.');
    assert.equal((paragraph.match(/Hypothesis/gi)||[]).length,1);
    const html=renderPostPage(content,baseURL);
    assert.ok(html.includes(`<p>${buyer}</p>`),'Original buyer text remains on the website.');
  }
});

test('multi-sentence shortening drops complete sentences instead of leaving clipped fragments',()=>{
  const sentences=['A small tool can route a support request to a checked workflow.','The first version should stay narrow enough for one student to test with a real customer before adding any further automated handoffs or paid service integrations.','A separate checker can reject unsupported claims and preserve the reason in a public record for later review instead of inventing a successful result.','The buyer must still decide whether that narrow workflow saves enough time to justify paying for it.'];
  const content={...post(),promise:sentences.join(' '),whoPays:sentences.join(' '),first24Hours:[sentences.join(' '),sentences.join(' '),sentences.join(' ')]};
  const description=rssDescription(content),paragraphs=description.split('\n\n');
  assert.ok(description.length<=1000);
  assert.ok(paragraphs[0].startsWith(sentences[0]));
  assert.doesNotMatch(description,/…/,'Every individual sentence is small enough to retain whole.');
  const fields=[paragraphs[0],paragraphs[1].replace(/^Who might pay: Hypothesis: /,''),...paragraphs[2].split('\n').slice(1).map(line=>line.replace(/^\d+\. /,''))];
  for(const field of fields){
    let remainder=field;
    for(const sentence of sentences)if(remainder.startsWith(sentence))remainder=remainder.slice(sentence.length).trimStart();
    assert.equal(remainder,'','Only complete original sentences remain in each field.');
  }
});

test('a single overlong sentence ends at a word boundary with an ellipsis',()=>{
  const sentence='A starter can '+('connect careful workflows with repeatable checks '.repeat(90))+'before deployment.';
  const description=rssDescription({...post(),promise:sentence}),promise=description.split('\n\n')[0];
  assert.ok(description.length<=1000);
  assert.ok(promise.endsWith('…'));
  const prefix=promise.slice(0,-1).trimEnd();
  assert.ok(sentence.startsWith(prefix));
  assert.equal(sentence[prefix.length],' ','The next original character is a word boundary.');
  assert.ok(description.includes('Who might pay: Hypothesis:'));
  assert.ok(description.includes('\n\nFirst 24 hours:\n1.'));
});

test('relay text removes API markup characters while retaining Unicode and original website copy',()=>{
  const content={...post(),title:'Café (AI) [checked] {tool} <demo> @team #tag *bold* _item_ ~note~ | path\\test',promise:'Žalgiris 🚀 helps (a team) [safely] {today} <now> @home #topic *small* _steps_ ~soon~ | here\\there.',whoPays:'Hypothesis: Café teams (with time pressure) [may pay].',first24Hours:['Build (one) [form] {first} <today> @home #one *now* _clean_ ~it~ | then\\test.']};
  const title=rssTitle(content.title),description=rssDescription(content);
  assert.doesNotMatch(title,relayMarkup);
  assert.doesNotMatch(description,relayMarkup);
  assert.ok(title.includes('Café'));
  assert.ok(description.includes('Žalgiris 🚀'));
  assert.equal(Buffer.from(description,'utf8').toString('utf8'),description);
  const longUnicode=rssDescription({...content,promise:('Žalgiris 🚀 café workflows '.repeat(100))+'finish.'});
  assert.equal(Buffer.from(longUnicode,'utf8').toString('utf8'),longUnicode);
  assert.ok(longUnicode.length<=1000);
  const html=renderPostPage(content,baseURL);
  assert.match(html,/<h1 id="post-title">Café \(AI\) \[checked\] \{tool\} &lt;demo&gt; @team #tag \*bold\* _item_ ~note~ \| path\\test<\/h1>/);
});

test('metadata descriptions stay one line, at most 300 characters and identical across all description tags',()=>{
  const sentence='Café teams can '+('review careful workflows before deployment '.repeat(30))+'today.';
  const content={...post(),promise:sentence,whoPays:'Hypothesis: A team may pay.\nA buyer has not been verified.'};
  const description=metaDescription(content);
  assert.ok(description.length<=300);
  assert.doesNotMatch(description,/[\r\n]/);
  assert.equal(Buffer.from(description,'utf8').toString('utf8'),description);
  const prefix=description.split('…')[0].trimEnd();
  assert.ok(sentence.startsWith(prefix));
  assert.equal(sentence[prefix.length],' ','Short metadata also stops at a whole word.');
  const html=renderPostPage(content,baseURL),tags=[];
  for(const attribute of ['name="description"','property="og:description"','name="twitter:description"']){
    const tag=html.match(new RegExp(`<meta ${attribute} content="([^"]*)">`));
    assert.ok(tag);
    tags.push(parser.parse(`<value>${tag[1]}</value>`).value);
  }
  assert.deepEqual(tags,[description,description,description]);
});

test('RSS parses as RSS 2.0, sorts newest first, and exposes exact card bytes and stable per-post URLs',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'wys-site-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'public','cards'),{recursive:true});
  const image=jpeg.encode({width:1080,height:1350,data:Buffer.alloc(1080*1350*4,255)},70).data;
  for(const id of ['old','new'])await fs.writeFile(path.join(root,'public','cards',id+'.jpg'),image);
  const posts=[post('old','2026-10-10T07:20:00.000Z'),post('new','2026-10-11T05:20:00.000Z')];
  const result=await writeSiteArtifacts({root,posts,baseURL:baseURL+'/'});
  assert.equal(result.feedUrl,baseURL+'/feed.xml');
  assert.equal(result.items,2);
  const xml=await fs.readFile(path.join(root,'public','feed.xml'),'utf8');
  assert.equal(XMLValidator.validate(xml),true);
  const rss=parser.parse(xml).rss;
  assert.equal(rss['@_version'],'2.0');
  assert.equal(rss['@_xmlns:media'],'http://search.yahoo.com/mrss/');
  assert.equal(rss.channel['atom:link']['@_href'],baseURL+'/feed.xml');
  assert.deepEqual(rss.channel.item.map(item=>item.guid['#text']),['new','old']);
  for(const item of rss.channel.item){
    const id=item.guid['#text'];
    assert.equal(item.guid['@_isPermaLink'],'false');
    assert.equal(item.link,`${baseURL}/p/${id}/`);
    assert.equal(item.title,rssTitle(posts[0].title));
    assert.doesNotMatch(item.title,relayMarkup);
    assert.ok(Number.isFinite(Date.parse(item.pubDate)));
    assert.ok(item.description.length<=1000);
    assert.equal(item.description,rssDescription(posts.find(post=>post.id===id)),'XML preserves paragraph and step newlines exactly.');
    assert.equal(item.description.split('\n\n').length,3);
    assert.match(item.description,/\n\nFirst 24 hours:\n1\. /);
    assert.doesNotMatch(item.description,relayMarkup);
    assert.equal(item.enclosure['@_url'],`${baseURL}/cards/${id}.jpg`);
    assert.equal(item.enclosure['@_type'],'image/jpeg');
    assert.equal(Number(item.enclosure['@_length']),image.length);
    assert.equal(item['media:content']['@_url'],item.enclosure['@_url']);
    assert.equal(item['media:content']['@_width'],'1080');
    assert.equal(item['media:content']['@_height'],'1350');
    const html=await fs.readFile(path.join(root,'public','p',id,'index.html'),'utf8');
    assert.match(html,new RegExp(`<link rel="canonical" href="${baseURL}/p/${id}/">`));
  }
});

test('static post page contains the complete post, sources and required sharing tags without executable source markup',()=>{
  const content=post();
  const html=renderPostPage(content,baseURL);
  assert.match(html,/<meta property="og:title" content="Ideas &amp; evidence &lt;checked&gt;">/);
  for(const [name,value] of [['og:description',metaDescription(content)],['og:image',baseURL+'/cards/one.jpg'],['og:url',baseURL+'/p/one/'],['og:type','article'],['og:image:width','1080'],['og:image:height','1350']]){
    const tag=html.match(new RegExp(`<meta property="${name}" content="([^"]*)">`));
    assert.ok(tag,`${name} is present`);
    const decoded=parser.parse(`<value>${tag[1]}</value>`).value;
    assert.equal(decoded,value);
  }
  assert.match(html,/<meta name="twitter:card" content="summary_large_image">/);
  assert.match(html,/<link rel="canonical" href="https:\/\/example.test\/while-you-sleep\/p\/one\/">/);
  assert.match(html,/The complete description, including &lt;untrusted&gt; text\./);
  assert.match(html,/An attributed observation with no invented numbers\./);
  assert.match(html,/Unknown adoption and reliability\./);
  assert.match(html,/Build a tiny form\./);
  assert.match(html,/Test it with one real user\./);
  assert.match(html,/https:\/\/example.org\/product\?a=one&amp;b=two/);
  assert.ok(html.includes(LINKEDIN_PAGE_URL));
  assert.doesNotMatch(html,/href="javascript:/);
  assert.doesNotMatch(html,/<untrusted>/);
});

test('public page generation rejects traversal IDs, duplicate GUIDs and missing images',async t=>{
  assert.throws(()=>publicPostURL(baseURL,'../../outside'),/Invalid public post ID/);
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'wys-site-invalid-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'public','cards'),{recursive:true});
  await assert.rejects(writeSiteArtifacts({root,posts:[post()],baseURL}),/ENOENT/);
  await fs.writeFile(path.join(root,'public','cards','one.jpg'),Buffer.from('image-test-fixture'));
  await assert.rejects(writeSiteArtifacts({root,posts:[post(),post()],baseURL}),/Duplicate published post ID/);
});

test('client clock ages unfilled slots and never treats an attempt as a publication',()=>{
  const slot={plannedAt:'2026-10-11T05:07:00Z',status:'scheduled',actualAt:null,attemptedAt:'2026-10-11T05:20:00Z'};
  assert.equal(slotPresentation(slot,'2026-10-11T05:00:00Z').state,'scheduled');
  assert.equal(slotPresentation(slot,'2026-10-11T05:30:00Z').state,'waiting');
  assert.equal(slotPresentation({...slot,status:'waiting'},'2026-10-11T05:40:00Z').state,'late');
  assert.equal(slotPresentation({...slot,status:'waiting'},'2026-10-11T06:30:00Z').state,'missed');
  assert.equal(slotPresentation(slot,'2026-10-11T06:30:00Z').state,'missed');
  assert.equal(slotPresentation(slot,'2026-10-11T06:30:00Z').actualAt,null);
  assert.equal(slotPresentation(slot,'2026-10-11T06:30:00Z').delayMinutes,null);
  const published=slotPresentation({...slot,actualAt:'2026-10-11T05:25:00Z'},'2026-10-11T07:00:00Z');
  assert.equal(published.state,'published');
  assert.equal(published.delayMinutes,18);
  assert.equal(slotPresentation({...slot,state:'cap_reached',status:'cap_reached'},'2026-10-11T07:00:00Z').state,'cap_reached');
});

test('aged slot reasons agree with future, waiting and missed states',()=>{
  const slot={scheduledAt:'2026-10-11T10:07:00Z',state:'scheduled',reason:'The planned publication time is still ahead.',actualAt:null};
  const future=slotPresentation(slot,'2026-10-11T09:00:00Z');
  assert.equal(future.state,'scheduled');
  assert.match(future.reason,/still ahead/);
  const waiting=slotPresentation(slot,'2026-10-11T10:20:00Z');
  assert.equal(waiting.state,'waiting');
  assert.match(waiting.reason,/No checked publication/);
  const missed=slotPresentation(slot,'2026-10-11T12:00:00Z');
  assert.equal(missed.state,'missed');
  assert.equal(missed.status,'missed');
  assert.doesNotMatch(missed.reason,/still ahead/);
});

test('after Vilnius midnight an old build yields all current-day slots without migrating yesterday receipts',()=>{
  const oldId='publish-2026-10-11-08-07';
  const data={schedule:{proof:{state:'trigger_observed'},slots:[{id:oldId,scheduledAt:'2026-10-11T05:07:00Z',state:'published',actualAt:'2026-10-11T05:25:00Z',postId:'old'}]},posts:[{id:'old',publishedAt:'2026-10-11T05:25:00Z',scheduling:{slotId:oldId},eventName:'schedule'}],runs:[]};
  const midnight=currentDaySlots(data,'2026-10-11T21:10:00Z');
  assert.deepEqual(midnight.map(slot=>slot.id),['publish-2026-10-12-08-07','publish-2026-10-12-13-07','publish-2026-10-12-19-07']);
  assert.deepEqual(midnight.map(slot=>slot.localTime),['08:07','13:07','19:07']);
  assert.ok(midnight.every(slot=>slot.state==='scheduled'&&slot.actualAt===null&&slot.postId===null));
  const morning=currentDaySlots(data,'2026-10-12T06:30:00Z');
  assert.equal(morning[0].state,'missed');
  assert.match(morning[0].reason,/No checked publication/);
  assert.equal(data.schedule.proof.state,'trigger_observed');
  assert.equal(data.schedule.slots[0].postId,'old');
});

test('current-day receipts merge exact post slots and retain manual attempts without changing schedule proof',()=>{
  const id='publish-2026-10-12-08-07';
  const data={schedule:{proof:{state:'trigger_observed'},slots:[]},posts:[{id:'current',publishedAt:'2026-10-12T05:25:00Z',scheduling:{slotId:id,eventName:'workflow_dispatch'},runId:'loop-123-1'}],runs:[{id:'loop-123-1',type:'loop',eventName:'workflow_dispatch',modelExecuted:true,startedAt:'2026-10-12T05:15:00Z',finishedAt:'2026-10-12T05:26:00Z',status:'completed',scheduling:{slotIds:[id],requestedAt:'2026-10-12T05:15:00Z'}}]};
  const slots=currentDaySlots(data,'2026-10-12T06:30:00Z');
  assert.equal(slots[0].state,'published');
  assert.equal(slots[0].actualAt,'2026-10-12T05:25:00Z');
  assert.equal(slots[0].attemptedAt,'2026-10-12T05:15:00Z');
  assert.equal(slots[0].delayMinutes,18);
  assert.equal(slots[0].eventName,'workflow_dispatch');
  assert.equal(data.schedule.proof.state,'trigger_observed');
  data.posts=[];
  data.runs[0].modelExecuted=false;
  data.runs[0].published=[];
  const attempt=currentDaySlots(data,'2026-10-12T06:30:00Z')[0];
  assert.equal(attempt.actualAt,null);
  assert.equal(attempt.state,'missed');
  assert.equal(attempt.eventName,'workflow_dispatch');
});
