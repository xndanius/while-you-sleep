import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_FEED_VIEW,readFeedView,feedViewURL,overallScore,filterAndSortPosts} from '../public/feed-view.js';

const now='2026-10-11T12:00:00.000Z';
const idea=(id,publishedAt,overall)=>({id,publishedAt,scoring:overall===undefined?null:{overall}});
const ids=posts=>posts.map(post=>post.id);

test('feed URL state accepts only complete whitelisted values and rejects ambiguous duplicates',()=>{
  assert.deepEqual(readFeedView(''),DEFAULT_FEED_VIEW);
  assert.deepEqual(readFeedView('?sort=best&min=7&period=24h'),{sort:'best',min:'7',period:'24h'});
  for(const query of ['?sort=BEST&min=7.0&period=1d','?sort=%3Cscript%3E&min=-1&period=forever','?sort=&min=&period=','?sort=best&sort=newest&min=7&min=8&period=24h&period=all'])assert.deepEqual(readFeedView(query),DEFAULT_FEED_VIEW);
  assert.deepEqual(readFeedView('?sort=best&min=9&period=7d'),{sort:'best',min:'any',period:'7d'});
});

test('share URLs round trip all choices, clear defaults, and preserve unrelated parameters and fragments',()=>{
  for(const sort of ['newest','best'])for(const min of ['any','6','7','8'])for(const period of ['24h','7d','all']){
    const state={sort,min,period},url=new URL(feedViewURL('https://example.test/channel/?ref=lecture&sort=bad&sort=best#post-one',state));
    assert.deepEqual(readFeedView(url.search),state);
    assert.equal(url.searchParams.get('ref'),'lecture');
    assert.equal(url.hash,'#post-one');
    assert.equal(url.pathname,'/channel/');
    for(const key of ['sort','min','period'])assert.ok(url.searchParams.getAll(key).length<=1);
  }
  assert.equal(feedViewURL('https://example.test/?sort=best&min=8&period=7d',DEFAULT_FEED_VIEW),'https://example.test/');
  assert.equal(feedViewURL('https://example.test/',{sort:'unsafe',min:8,period:'forever'}),'https://example.test/');
});

test('newest is the default and best uses unrounded means, recent ties and stable IDs without mutating input',()=>{
  const posts=[idea('older-best','2026-10-10T12:00:00.000Z',8.03),idea('pending','2026-10-11T11:59:00.000Z'),idea('tie-b','2026-10-11T10:00:00.000Z',8.04),idea('tie-a','2026-10-11T10:00:00.000Z',8.04),idea('old-tie','2026-10-09T12:00:00.000Z',8.04)];
  const original=structuredClone(posts);
  assert.deepEqual(ids(filterAndSortPosts(posts,DEFAULT_FEED_VIEW,now)),['pending','tie-a','tie-b','older-best','old-tie']);
  assert.deepEqual(ids(filterAndSortPosts(posts,{sort:'best'},now)),['tie-a','tie-b','old-tie','older-best','pending']);
  assert.deepEqual(posts,original);
  assert.equal(overallScore(posts[0]),8.03);
});

test('minimum score uses the exact mean and excludes pending or malformed scores',()=>{
  const posts=[idea('rounded-eight','2026-10-11T10:00:00.000Z',7.96),idea('exact-eight','2026-10-11T10:00:00.000Z',8),idea('six','2026-10-11T10:00:00.000Z',6),idea('pending','2026-10-11T10:00:00.000Z'),idea('infinite','2026-10-11T10:00:00.000Z',Infinity),idea('string','2026-10-11T10:00:00.000Z','9'),idea('above-range','2026-10-11T10:00:00.000Z',11)];
  assert.deepEqual(ids(filterAndSortPosts(posts,{min:'8'},now)),['exact-eight']);
  assert.deepEqual(ids(filterAndSortPosts(posts,{min:'7'},now)),['exact-eight','rounded-eight']);
  assert.deepEqual(ids(filterAndSortPosts(posts,{min:'6'},now)),['exact-eight','rounded-eight','six']);
  assert.equal(filterAndSortPosts(posts,{min:'any'},now).length,posts.length);
  for(const post of posts.slice(3))assert.equal(overallScore(post),null);
});

test('period filters include the exact rolling boundary and reject future or unrecorded publication times',()=>{
  const posts=[idea('now',now,7),idea('day-boundary','2026-10-10T12:00:00.000Z',7),idea('outside-day','2026-10-10T11:59:59.999Z',7),idea('week-boundary','2026-10-04T12:00:00.000Z',7),idea('outside-week','2026-10-04T11:59:59.999Z',7),idea('future','2026-10-11T12:00:00.001Z',9),idea('invalid','unknown',9)];
  assert.deepEqual(ids(filterAndSortPosts(posts,{period:'24h'},now)),['now','day-boundary']);
  assert.deepEqual(ids(filterAndSortPosts(posts,{period:'7d'},now)),['now','day-boundary','outside-day','week-boundary']);
  assert.equal(filterAndSortPosts(posts,{period:'all'},now).length,posts.length);
  assert.throws(()=>filterAndSortPosts(posts,DEFAULT_FEED_VIEW,'unknown'),/valid feed view time/);
});

test('all three choices combine on saved ideas without changing the saved collection',()=>{
  const posts=[idea('saved-best','2026-10-11T10:00:00.000Z',8),idea('unsaved-best','2026-10-11T11:00:00.000Z',9),idea('saved-low','2026-10-11T11:30:00.000Z',5),idea('saved-old','2026-10-01T10:00:00.000Z',10)];
  const saved=new Set(['saved-best','saved-low','saved-old']);
  assert.deepEqual(ids(filterAndSortPosts(posts.filter(post=>saved.has(post.id)),{sort:'best',min:'7',period:'7d'},now)),['saved-best']);
  assert.deepEqual([...saved],['saved-best','saved-low','saved-old']);
});
