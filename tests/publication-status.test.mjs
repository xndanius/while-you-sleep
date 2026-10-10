import test from 'node:test';
import assert from 'node:assert/strict';
import { measuredPublication } from '../lib/publication-status.mjs';

const receipt={postId:'idea-1',createdAt:'2026-10-10T12:00:00Z',submittedAt:'2026-10-10T12:00:00Z'};
const submitted={provider:'postiz',providerPostId:'provider-1',status:'submitted',message:'Awaiting confirmation'};
const metrics=(measuredAt='2026-10-10T12:05:00Z',providerPostId='provider-1')=>({social:{measuredAt,posts:[{postId:'idea-1',x:{publication:{status:'published',providerPostId}}}]}});

test('a later confirmation upgrades the same provider publication without inventing its publication time',()=>{
  const result=measuredPublication(receipt,submitted,'x',metrics());
  assert.equal(result.status,'published');
  assert.match(result.message,/confirmed/);
  assert.equal(result.publishedAt,undefined);
  assert.equal(submitted.status,'submitted');
  assert.equal(measuredPublication(receipt,submitted,'x',metrics(receipt.createdAt)).status,'published');
});

test('stale, missing, or invalid measurement dates cannot confirm a newer receipt',()=>{
  for(const date of ['2026-10-10T11:59:59Z',null,'invalid'])assert.equal(measuredPublication(receipt,submitted,'x',metrics(date)),submitted);
  const newerReceipt={...receipt,createdAt:'2026-10-10T12:06:00Z'};
  assert.equal(measuredPublication(newerReceipt,submitted,'x',metrics()),submitted);
});

test('confirmation is bound to the receipt post, platform, and provider ID',()=>{
  assert.equal(measuredPublication(receipt,submitted,'x',metrics(undefined,'provider-old')),submitted);
  assert.equal(measuredPublication({...receipt,postId:'idea-2'},submitted,'x',metrics()),submitted);
  assert.equal(measuredPublication(receipt,submitted,'instagram',metrics()),submitted);
  assert.equal(measuredPublication(receipt,submitted,'x',{}),submitted);
  const published={...submitted,status:'published',publishedAt:'2026-10-10T12:02:00Z'};
  assert.equal(measuredPublication(receipt,published,'x',metrics()),published);
});
