import test from 'node:test';
import assert from 'node:assert/strict';
import {clockTiming,runTriggerLabel} from '../public/clock-display.js';

test('clock display distinguishes first wait, recorded ticks, lateness and stalled state using the current clock',()=>{
  const clock={phase:'waiting',lastTickAt:'2026-10-11T06:00:00Z',nextTickAt:'2026-10-11T06:15:00Z',claimedAt:'2026-10-11T06:01:00Z'};
  assert.equal(clockTiming({},'2026-10-11T06:05:00Z').state,'not_started');
  assert.equal(clockTiming({phase:'waiting',claimedAt:clock.claimedAt,nextTickAt:'2026-10-11T06:16:00Z'},'2026-10-11T06:05:00Z').label,'First clock tick waiting');
  assert.equal(clockTiming(clock,'2026-10-11T06:10:00Z').state,'waiting');
  assert.equal(clockTiming(clock,'2026-10-11T06:18:00Z').state,'late');
  assert.equal(clockTiming(clock,'2026-10-11T06:18:00Z').lateMinutes,3);
  assert.equal(clockTiming(clock,'2026-10-11T06:45:00Z').state,'late');
  assert.equal(clockTiming(clock,'2026-10-11T06:45:01Z').state,'stalled');
  assert.equal(clockTiming({...clock,lastTickAt:'2026-10-11T07:00:00Z'},'2026-10-11T06:10:00Z').state,'unverified');
});

test('only trusted clock verifier output distinguishes clock dispatches while keeping the real GitHub event',()=>{
  const run={eventName:'workflow_dispatch',triggerEvent:'schedule',clock_origin:'yes'};
  assert.equal(runTriggerLabel(run),'Manual dispatch · workflow_dispatch');
  assert.equal(runTriggerLabel({...run,clock:{source:'github-environment-clock',verified:false}}),'Manual dispatch · workflow_dispatch');
  assert.equal(runTriggerLabel({...run,clock:{source:'github-environment-clock',verified:true}}),'Manual dispatch · workflow_dispatch');
  const verified={...run,id:'loop-123-1',githubRunUrl:'https://github.com/xndanius/while-you-sleep/actions/runs/123',clock:{source:'github-environment-clock',verified:true,workflow:'loop.yml',runId:'123'}};
  assert.equal(runTriggerLabel(verified),'Hosted clock dispatch · workflow_dispatch');
  assert.equal(runTriggerLabel({...verified,clock:{...verified.clock,runAttempt:1,actor:'github-actions[bot]',triggeringActor:'github-actions[bot]'}}),'Hosted clock dispatch · workflow_dispatch');
  assert.equal(runTriggerLabel({...verified,id:'loop-123-2'}),'Manual rerun · original workflow_dispatch');
  assert.equal(runTriggerLabel({...verified,clock:{...verified.clock,actor:'owner'}}),'Manual dispatch · workflow_dispatch');
  assert.equal(runTriggerLabel({...verified,githubRunUrl:'https://github.com/other/repo/actions/runs/123'}),'Manual dispatch · workflow_dispatch');
  const curator={...verified,id:'curate-123-1',clock:{...verified.clock,workflow:'curate.yml',runAttempt:1,actor:'github-actions[bot]',triggeringActor:'github-actions[bot]'}};
  assert.equal(runTriggerLabel(curator),'Hosted clock dispatch · workflow_dispatch');
  assert.equal(runTriggerLabel({...curator,id:'curate-123-2'}),'Manual rerun · original workflow_dispatch');
  assert.equal(runTriggerLabel({...curator,clock:{...curator.clock,triggeringActor:'owner'}}),'Manual dispatch · workflow_dispatch');
  assert.equal(runTriggerLabel({eventName:'schedule'}),'GitHub cron · schedule');
});
