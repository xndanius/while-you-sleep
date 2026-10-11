import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {renderCard} from '../lib/card.mjs';
import {contentHash} from '../lib/validation.mjs';
import {publishedScoring,scoringPolicyHash} from '../lib/scoring.mjs';
import {bestRSSDescription,rssDescription,rssTitle,writeSiteArtifacts} from '../lib/site-artifacts.mjs';

const baseURL='https://example.test/channel';
const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false});
const banned=/[()[\]{}<>@#*_~|\\]/u;
const policy=weights=>({weights,threshold:6,policySha256:scoringPolicyHash(weights,6)});
const weights={ease:1,profit:1,feasibility:1,autonomy:1,evidence:1};
const scoring=()=>publishedScoring(Object.fromEntries(Object.entries({ease:8,profit:7,feasibility:9,autonomy:8,evidence:7}).map(([key,value])=>[key,{value,reason:key==='profit'?'Hypothesis: a buyer may value this bounded fixture; demand is unproved.':'A bounded synthetic fixture supports the presentation test.',sourceIds:['fixture-source']}])),policy(weights),{checkedAt:'2026-10-11T11:00:00.000Z',checkerRunId:'fixture-independent-check'});
function post(id='fixture-one',publishedAt='2026-10-11T10:20:00.000Z'){
  const record={id,publishedAt,title:'Café (AI) [checked] & evidence',promise:'A bounded example helps a small team.',whoPays:'Hypothesis: Hypothesis: a team may pay; demand is unproved.',whatItIs:'A synthetic fixture, never a real post.',loop:['Read a public source.','Check a result.','Ask a human to review.'],evidence:'A fixture demonstrates the relay format.',uncertainty:'This is a test example.',first24Hours:['Build a small form.','Review one result.','Record the limits.'],sources:[{id:'fixture-source',url:'https://example.org/demo',title:'Fixture demonstration'}],checker:{passed:true,checkerRunId:'original-fixture-check'}};
  record.contentSha256=contentHash(record);
  return record;
}
const pick=(post,pickedAt='2026-10-11T15:00:00.000Z')=>({postId:post.id,postContentSha256:post.contentSha256,publishedAt:post.publishedAt,pickedAt,scoring:scoring()});
async function fixtureRoot(t,posts){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'wys-best-rss-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'public','cards'),{recursive:true});
  for(const post of posts)await fs.writeFile(path.join(root,'public','cards',post.id+'.jpg'),renderCard(post));
  return root;
}
const readFeed=async(root,name)=>{
  const xml=await fs.readFile(path.join(root,'public',name),'utf8');
  assert.equal(XMLValidator.validate(xml),true);
  return {xml,rss:parser.parse(xml).rss};
};

test('best RSS begins empty even when existing scored posts are eligible in the ordinary feed',async t=>{
  const original=post(),posts=[{...original,scoring:scoring()}],root=await fixtureRoot(t,posts);
  const result=await writeSiteArtifacts({root,posts,baseURL,styleVersion:'abcdef012345'});
  assert.equal(result.bestFeedUrl,baseURL+'/best.xml');
  assert.equal(result.bestItems,0);
  const {rss}=await readFeed(root,'best.xml');
  assert.equal(rss['@_version'],'2.0');
  assert.equal(rss['@_xmlns:media'],'http://search.yahoo.com/mrss/');
  assert.equal(rss['@_xmlns:atom'],'http://www.w3.org/2005/Atom');
  assert.equal(rss.channel['atom:link']['@_href'],baseURL+'/best.xml');
  assert.equal(rss.channel.item,undefined,'No implicit activation backfill.');
  assert.equal(rss.channel.lastBuildDate,undefined);
  const ordinary=await readFeed(root,'feed.xml');
  assert.equal(ordinary.rss.channel.item.guid['#text'],original.id);
  const html=await fs.readFile(path.join(root,'public','p',original.id,'index.html'),'utf8');
  assert.ok(html.includes('/styles.css?v=abcdef012345'),'Stylesheet versioning remains intact.');
});

test('only durable picks appear, newest pick first, with original identity/date/card metadata and frozen score text',async t=>{
  const older=post('fixture-old','2026-10-11T10:10:00.000Z'),newer=post('fixture-new','2026-10-11T10:20:00.000Z'),unpicked=post('fixture-unpicked','2026-10-11T11:00:00.000Z');
  const posts=[older,newer,unpicked],root=await fixtureRoot(t,posts);
  await writeSiteArtifacts({root,posts,baseURL});
  const before=await readFeed(root,'feed.xml');
  const picks=[pick(older,'2026-10-11T15:00:00.000Z'),pick(newer,'2026-10-11T12:00:00.000Z')];
  const originals=structuredClone({posts,picks});
  const result=await writeSiteArtifacts({root,posts,baseURL:baseURL+'/',picks});
  assert.equal(result.bestItems,2);
  const after=await readFeed(root,'feed.xml');
  assert.equal(after.xml,before.xml,'Adding picks cannot change the ordinary RSS feed.');
  const {rss}=await readFeed(root,'best.xml');
  assert.deepEqual(rss.channel.item.map(item=>item.guid['#text']),[older.id,newer.id]);
  assert.equal(rss.channel.lastBuildDate,new Date(picks[0].pickedAt).toUTCString());
  for(const item of rss.channel.item){
    const original=posts.find(post=>post.id===item.guid['#text']),ordinary=after.rss.channel.item.find(item=>item.guid['#text']===original.id);
    for(const key of ['title','link','guid','pubDate','enclosure','media:content'])assert.deepEqual(item[key],ordinary[key],`${key} follows the original publication.`);
    assert.equal(item.guid['@_isPermaLink'],'false');
    assert.equal(item.pubDate,new Date(original.publishedAt).toUTCString());
    assert.equal(item.description,bestRSSDescription(original,picks.find(pick=>pick.postId===original.id).scoring));
    assert.match(item.description,/^Score 7\.8\/10 - ease 8, profit 7, feasibility 9, autonomy 8, evidence 7\n/);
    const paragraphs=item.description.split('\n\n');
    assert.equal(paragraphs.length,3);
    assert.equal(paragraphs[0].split('\n')[1],original.promise);
    assert.deepEqual(paragraphs.slice(1),rssDescription(original).split('\n\n').slice(1));
    assert.doesNotMatch(item.title,banned);
    assert.doesNotMatch(item.description,banned);
    assert.ok(item.description.length<=1000);
    assert.doesNotMatch(item.description,/Sources on the page/);
    const card=await fs.stat(path.join(root,'public','cards',original.id+'.jpg'));
    assert.equal(Number(item.enclosure['@_length']),card.size);
  }
  assert.deepEqual({posts,picks},originals,'Generating feeds cannot rewrite durable pick or post data.');
});

test('later rule weights or current website scores cannot change an earlier pick description',async t=>{
  const original=post(),frozenPick=pick(original),root=await fixtureRoot(t,[original]);
  await writeSiteArtifacts({root,posts:[{...original,scoring:scoring()}],picks:[frozenPick],baseURL});
  const before=await readFeed(root,'best.xml');
  const current=publishedScoring(frozenPick.scoring.criteria,policy({...weights,evidence:10}),{checkedAt:frozenPick.scoring.checkedAt,checkerRunId:frozenPick.scoring.checkerRunId});
  assert.notEqual(current.overall,frozenPick.scoring.overall);
  await writeSiteArtifacts({root,posts:[{...original,scoring:current}],picks:[frozenPick],baseURL});
  const after=await readFeed(root,'best.xml');
  assert.equal(after.xml,before.xml,'The frozen selection prefix survives current-policy reaggregation.');
});

test('best descriptions reserve score space, keep Unicode and whole sentence/word boundaries, and relay at most three steps',()=>{
  const sentence='A café workflow can '+('check careful public evidence before deployment '.repeat(20))+'today.';
  const content={...post(),promise:sentence,whoPays:'Hypothesis: '+sentence,first24Hours:[sentence,sentence,sentence,'A fourth step is not relayed.']};
  const description=bestRSSDescription(content,scoring()),paragraphs=description.split('\n\n'),promise=paragraphs[0].split('\n')[1];
  assert.equal(paragraphs.length,3);
  assert.ok(description.length<=1000);
  assert.ok(promise.endsWith('…'));
  const prefix=promise.slice(0,-1).trimEnd();
  assert.ok(sentence.startsWith(prefix));
  assert.equal(sentence[prefix.length],' ');
  assert.equal(Buffer.from(description,'utf8').toString('utf8'),description);
  assert.equal(paragraphs[2].split('\n').length,4);
  assert.doesNotMatch(description,/fourth step|Sources on the page/);
  const full='A café workflow can check public evidence. A source supports a narrow prototype. Human review still matters.';
  const whole=bestRSSDescription({...content,promise:full},scoring()).split('\n\n')[0].split('\n')[1];
  assert.doesNotMatch(whole,/…/);
  assert.ok(whole.endsWith('.'));
  for(const fragment of whole.split(/(?<=\.) /))assert.ok(full.includes(fragment));
  const unsafe=bestRSSDescription({...post(),promise:'Café (AI) [scope] {now} <demo> @team #one *small* _step_ ~soon~ | path\\test.',whoPays:'Hypothesis: Hypothesis: a team (may pay).'},scoring());
  assert.doesNotMatch(unsafe,banned);
  assert.equal((unsafe.match(/Hypothesis:/g)||[]).length,1);
  assert.equal(rssTitle('Café [AI] @team'),'Café AI team');
  const maximum=scoring();
  for(const criterion of Object.values(maximum.criteria))criterion.value=10;
  maximum.overall=10;
  const maximal=bestRSSDescription(content,maximum);
  assert.match(maximal,/^Score 10\.0\/10 - ease 10, profit 10, feasibility 10, autonomy 10, evidence 10\n/);
  assert.ok(maximal.length<=1000,'Even the longest numeric score prefix reserves enough space.');
});

test('unknown, duplicated or mismatched picks and malformed frozen scores fail closed',async t=>{
  const original=post(),root=await fixtureRoot(t,[original]),valid=pick(original);
  for(const [picks,reason] of [[[{...valid,postId:'unknown'}],/unknown published post/],[[valid,valid],/Duplicate LinkedIn pick/],[[{...valid,publishedAt:'2026-10-11T12:00:00.000Z'}],/frozen publication metadata/],[[{...valid,postContentSha256:'b'.repeat(64)}],/frozen publication metadata/],[[{...valid,pickedAt:'unknown'}],/frozen publication metadata/]])await assert.rejects(writeSiteArtifacts({root,posts:[original],picks,baseURL}),reason);
  assert.throws(()=>bestRSSDescription(original,{...scoring(),overall:NaN}),/Invalid hydrated presentation score/);
  const invalid=scoring();invalid.criteria.ease.value=11;
  assert.throws(()=>bestRSSDescription(original,invalid),/Invalid frozen pick criterion score/);
});
