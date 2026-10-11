import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { XMLParser,XMLValidator } from 'fast-xml-parser';
import jpeg from 'jpeg-js';
import { LINKEDIN_PAGE_URL,publicPostURL,rssDescription,renderPostPage,writeSiteArtifacts } from '../lib/site-artifacts.mjs';
import { slotPresentation } from '../public/slot-display.js';

const baseURL='https://example.test/while-you-sleep';
const post=(id='one',publishedAt='2026-10-11T05:20:00.000Z')=>({id,publishedAt,title:'Ideas & evidence <checked>',promise:'A useful promise & a clear limit.',whatItIs:'The complete description, including <untrusted> text.',whoPays:'Teams who need a small tool.',loop:['Research & gather','Check <claims>','Publish'],evidence:'An attributed observation with no invented numbers.',uncertainty:'Unknown adoption and reliability.',first24Hours:['Build a tiny form.','Test it with one real user.'],sources:[{title:'The maker & product',url:'https://example.org/product?a=one&b=two',publisher:'Example'},{title:'Never execute',url:'javascript:alert(1)'}]});
const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false});

test('relay descriptions remain plaintext under 600 characters with every required field',()=>{
  const description=rssDescription({...post(),promise:'<b>'+('promise '.repeat(100))+'</b>',whoPays:'buyers '.repeat(100),first24Hours:['first action '.repeat(100)]});
  assert.ok(description.length<600);
  assert.doesNotMatch(description,/<\/?b>/);
  assert.match(description,/Who pays: buyers/);
  assert.match(description,/First 24 hours: first action/);
  assert.ok(description.endsWith('Sources on the page.'));
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
    assert.equal(item.title,posts[0].title);
    assert.ok(Number.isFinite(Date.parse(item.pubDate)));
    assert.ok(item.description.length<600);
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
  for(const [name,value] of [['og:description',rssDescription(content)],['og:image',baseURL+'/cards/one.jpg'],['og:url',baseURL+'/p/one/'],['og:type','article'],['og:image:width','1080'],['og:image:height','1350']]){
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
