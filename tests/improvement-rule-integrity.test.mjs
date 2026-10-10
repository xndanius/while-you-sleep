import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {writeJSON} from '../lib/storage.mjs';
import {runVerifier,verifyImprovementRule} from '../scripts/verify-improvement-rule.mjs';

const runId='improve-123-2';
const rules='# Rules\n\n## Pick\nUse evidence.\n\n## Write\nExplain the first input.\n\n## Safety\nKeep exclusions.\n';
const digest=value=>createHash('sha256').update(value).digest('hex');
const adopted={id:runId,status:'adopted',adopted:true,newRulesSha256:digest(rules)};

test('adopted version permits only its exact bytes, including newline and unrelated merged sections',()=>{
  assert.deepEqual(verifyImprovementRule({runId,record:adopted,rulesBytes:Buffer.from(rules)}),{runId,status:'adopted',ruleHashChecked:true});
  for(const changed of [rules+'\n',rules.replace('Keep exclusions.','Keep exclusions and human review.'),rules.replaceAll('\n','\r\n')]) {
    assert.throws(()=>verifyImprovementRule({runId,record:adopted,rulesBytes:Buffer.from(changed)}),/exact adopted improvement/);
  }
  // Hash the file bytes, not a UTF-8-decoded string that could normalize invalid
  // byte sequences into the same replacement character.
  const replacement={...adopted,newRulesSha256:digest('\uFFFD')};
  assert.throws(()=>verifyImprovementRule({runId,record:replacement,rulesBytes:Buffer.from([0xff])}),/exact adopted improvement/);
});

test('rejected version preserves any concurrent upstream rule edits without reading or hashing them',()=>{
  const rejected={id:runId,status:'rejected',adopted:false,newRulesSha256:digest('old baseline')};
  assert.deepEqual(verifyImprovementRule({runId,record:rejected}),{runId,status:'rejected',ruleHashChecked:false});
  assert.deepEqual(verifyImprovementRule({runId,record:rejected,rulesBytes:'concurrent owner edits'}),{runId,status:'rejected',ruleHashChecked:false});
});

test('wrong run identity, contradictory status and malformed adopted hashes fail closed',()=>{
  for(const record of [{...adopted,id:'improve-124-2'},{...adopted,status:'rejected'},{...adopted,adopted:false},{...adopted,newRulesSha256:'not-a-hash'},{...adopted,status:'unknown'},undefined]) {
    assert.throws(()=>verifyImprovementRule({runId,record,rulesBytes:rules}));
  }
  for(const id of ['../improve-123-2','improve-123-0','another-123-2','improve-123-2.json'])assert.throws(()=>verifyImprovementRule({runId:id,record:{...adopted,id},rulesBytes:rules}),/immutable run ID/);
});

test('runner verifies the current attempt and never changes version or RULES files',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'wys-rule-integrity-'));
  try{
    const file=path.join(root,'data','versions',runId+'.json');
    await writeJSON(file,adopted,{immutable:true});await writeFile(path.join(root,'RULES.md'),rules);
    const before=await readFile(file,'utf8');
    const env={GITHUB_ACTIONS:'true',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'2'};
    assert.equal((await runVerifier({root,argv:[runId],env})).status,'adopted');
    await assert.rejects(()=>runVerifier({root,argv:[runId],env:{...env,GITHUB_RUN_ATTEMPT:'3'}}),/workflow attempt/);
    await writeFile(path.join(root,'RULES.md'),rules+'owner addition\n');
    await assert.rejects(()=>runVerifier({root,argv:[runId],env}),/exact adopted improvement/);
    assert.equal(await readFile(file,'utf8'),before);
    assert.equal(await readFile(path.join(root,'RULES.md'),'utf8'),rules+'owner addition\n');
  }finally{await rm(root,{recursive:true,force:true});}
});
