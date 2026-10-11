import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {loopTiming} from '../public/schedule.js';
import {currentDaySlots} from '../public/slot-display.js';
import {DEFAULT_FEED_VIEW,readFeedView,feedViewURL,overallScore,filterAndSortPosts} from '../public/feed-view.js';

const score=value=>({overall:value,criteria:Object.fromEntries(['ease','profit','feasibility','autonomy','evidence'].map(key=>[key,{value:7}]))});
const idea=(id,overall,minutesAgo)=>({id,title:`Idea ${id}`,promise:'A checked small scope.',publishedAt:new Date(Date.now()-minutesAgo*60000).toISOString(),scoring:score(overall),sources:[]});
const postIds=markup=>[...markup.matchAll(/data-post-id="([^"]+)"/g)].map(match=>match[1]);

async function feedHarness({posts,url='https://example.test/channel/',saved=[]}){
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>{
    const listeners=new Map(),classes=new Set();
    return [match[1],{innerHTML:'',textContent:'',value:'',disabled:false,attributes:{},classList:{add:value=>classes.add(value),remove:value=>classes.delete(value),toggle:(value,active)=>active?classes.add(value):classes.delete(value),contains:value=>classes.has(value)},setAttribute(name,value){this.attributes[name]=value;},addEventListener(name,callback){listeners.set(name,callback);},emit(name,event={}){listeners.get(name)?.(event);},querySelectorAll(){return [];},focus(){},scrollIntoView(){}}];
  }));
  const windowEvents=new Map(),stored=new Map([['wys-saved',JSON.stringify(saved)]]),history=[];
  const browser={location:new URL(url),addEventListener:(name,callback)=>windowEvents.set(name,callback),history:{pushState(_state,_unused,next){history.push(next);browser.location=new URL(next);}}};
  const document={baseURI:url,hidden:false,getElementById:id=>elements.get(id)||null,addEventListener(){}};
  const localStorage={getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)};
  const data={posts,status:{state:'running'},schedule:{proof:{state:'publication_observed'}}};
  const source=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace(/^import .+;\n/gm,'');
  vm.runInNewContext(source,{loopTiming,currentDaySlots,DEFAULT_FEED_VIEW,readFeedView,feedViewURL,overallScore,filterAndSortPosts,document,window:browser,localStorage,fetch:async()=>({ok:true,json:async()=>data}),AbortController,URL,Date,Intl,console,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1});
  await new Promise(resolve=>setImmediate(resolve));
  return {elements,browser,stored,history,popstate(next){browser.location=new URL(next);windowEvents.get('popstate')?.();},clickPosts(selector,button){elements.get('posts').emit('click',{preventDefault(){},target:{closest:value=>value===selector?button:null}});}};
}

test('loaded filtered views show exact result counts and honest no-match state with a clear action',async()=>{
  const harness=await feedHarness({posts:[idea('low',6.4,60)],url:'https://example.test/channel/?min=8&period=7d'});
  const {elements}=harness;
  assert.equal(elements.get('post-count').textContent,'(0)');
  assert.match(elements.get('posts').innerHTML,/No ideas match these filters/);
  assert.doesNotMatch(elements.get('posts').innerHTML,/first ideas are on their way/);
  assert.equal(elements.get('minimum-score').value,'8');
  assert.equal(elements.get('feed-period').value,'7d');
  harness.clickPosts('[data-reset-filters]',{});
  assert.deepEqual(postIds(elements.get('posts').innerHTML),['low']);
  assert.equal(elements.get('post-count').textContent,'(1)');
  assert.equal(harness.browser.location.search,'');
});

test('sort and filter controls update share URLs and Back restores controls, order and score summaries',async()=>{
  const harness=await feedHarness({posts:[idea('recent',6.6,10),idea('best',8.2,60)]});
  const {elements}=harness;
  assert.deepEqual(postIds(elements.get('posts').innerHTML),['recent','best']);
  elements.get('best-sort').emit('click');
  assert.deepEqual(postIds(elements.get('posts').innerHTML),['best','recent']);
  assert.equal(harness.browser.location.search,'?sort=best');
  elements.get('minimum-score').value='7';
  elements.get('minimum-score').emit('change');
  assert.deepEqual(postIds(elements.get('posts').innerHTML),['best']);
  assert.equal(harness.browser.location.search,'?sort=best&min=7');
  assert.match(elements.get('posts').innerHTML,/<strong>8\.2<small> \/ 10<\/small>/);
  for(const label of ['Ease','Profit','Feasibility','Autonomy','Evidence'])assert.ok(elements.get('posts').innerHTML.includes(`<dt>${label}</dt>`));
  harness.popstate('https://example.test/channel/');
  assert.deepEqual(postIds(elements.get('posts').innerHTML),['recent','best']);
  assert.equal(elements.get('newest-sort').attributes['aria-pressed'],'true');
  assert.equal(elements.get('best-sort').attributes['aria-pressed'],'false');
  assert.equal(elements.get('minimum-score').value,'any');
  assert.equal(elements.get('post-count').textContent,'(2)');
});

test('saved view keeps URL filters and saving or removing an idea does not reset the selected view',async()=>{
  const harness=await feedHarness({posts:[idea('saved',7.4,30),idea('unsaved',8.2,60),idea('saved-low',5.8,90)],url:'https://example.test/channel/?sort=best&min=7',saved:['saved','saved-low']});
  const {elements}=harness;
  elements.get('saved-tab').emit('click');
  assert.deepEqual(postIds(elements.get('posts').innerHTML),['saved']);
  assert.equal(elements.get('post-count').textContent,'(1)');
  assert.equal(elements.get('saved-count').textContent,'2');
  harness.clickPosts('[data-save]',{dataset:{save:'saved'}});
  assert.match(elements.get('posts').innerHTML,/No ideas match these filters/);
  assert.deepEqual(JSON.parse(harness.stored.get('wys-saved')),['saved-low']);
  assert.equal(harness.browser.location.search,'?sort=best&min=7');
  elements.get('all-tab').emit('click');
  assert.deepEqual(postIds(elements.get('posts').innerHTML),['unsaved','saved']);
  harness.clickPosts('[data-save]',{dataset:{save:'unsaved'}});
  elements.get('saved-tab').emit('click');
  assert.deepEqual(postIds(elements.get('posts').innerHTML),['unsaved']);
  assert.equal(harness.browser.location.search,'?sort=best&min=7');
});
