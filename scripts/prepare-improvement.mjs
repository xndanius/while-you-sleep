import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { ROOT,dataPath,readJSON,writeJSON,records,hash,sha256,stableJSON,candidateIdentity,safeError,validId } from '../lib/storage.mjs';
import { scanSources,fetchPublic,plainText } from '../lib/research.mjs';
import { deterministicCheck } from '../lib/validation.mjs';
import { validateRuleProposal } from '../lib/improvement.mjs';
import { localParts } from '../lib/config.mjs';

const [command,runId,variant,importKind]=process.argv.slice(2);
async function output(values){if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,Object.entries(values).map(([k,v])=>`${k}=${v}\n`).join(''));console.log(JSON.stringify(values));}
async function context(value){await writeJSON(path.join(ROOT,'.run','improvement-context.json'),value);}
try{
  if(command==='gate'){
    // The cron already has Europe/Vilnius timezone. Let a queued scheduled run
    // catch up even if GitHub starts it after the advertised hour.
    const due=['workflow_dispatch','schedule'].includes(process.env.GITHUB_EVENT_NAME);
    await output({due:String(due),runId:`improve-${process.env.GITHUB_RUN_ID||Date.now()}-${process.env.GITHUB_RUN_ATTEMPT||1}`});
  }else{
    if(!validId(runId))throw new Error('Invalid improvement run ID.');
    if(command==='import'){
      const base=path.resolve(variant),allowed=new Map();
      if(importKind==='input')for(const [relative,directory,name] of [['research/'+runId+'.json','research',runId],['improvements/'+runId+'-input.json','improvements',runId+'-input'],['improvements/'+runId+'.json','improvements',runId]])allowed.set(relative,{directory,name});
      else if(importKind==='trials')for(const suffix of ['-trial-baseline','-trial-proposal'])allowed.set(runId+suffix+'.json',{directory:'improvements',name:runId+suffix});
      else if(importKind==='evaluation')for(const suffix of ['-labels','-blind'])allowed.set(runId+suffix+'.json',{directory:'improvements',name:runId+suffix});
      else if(importKind==='grade')allowed.set('grade.json',{directory:'improvements',name:runId+'-grade'});
      else throw new Error('Unknown improvement artifact type.');
      let imported=0;
      async function visit(relative=''){
        for(const entry of await fs.readdir(path.join(base,relative),{withFileTypes:true})){
          const next=path.join(relative,entry.name),normalized=next.split(path.sep).join('/');
          if(entry.isSymbolicLink())throw new Error('Improvement artifact symlinks are forbidden.');
          if(entry.isDirectory()){if(importKind!=='input'||!['research','improvements'].includes(normalized))throw new Error('Unexpected improvement artifact directory.');await visit(next);continue;}
          const target=allowed.get(normalized);if(!entry.isFile()||!target)throw new Error('Improvement artifact belongs to an unexpected file or run.');
          const bytes=await fs.readFile(path.join(base,next));if(bytes.length>2500000)throw new Error('Improvement artifact is too large.');
          const text=bytes.toString('utf8');if(/\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}/.test(text))throw new Error('Possible credential found in an improvement artifact.');
          const record=JSON.parse(text);if(record.runId!==runId)throw new Error('Improvement artifact run ID is inconsistent.');
          if(target.name===runId+'-input'&&process.env.EXPECTED_INPUT_SHA256&&sha256(stableJSON(record))!==process.env.EXPECTED_INPUT_SHA256)throw new Error('The proposer changed its frozen baseline, sources, or measurement input.');
          if(target.directory==='research'&&process.env.EXPECTED_RESEARCH_SHA256&&sha256(stableJSON(record))!==process.env.EXPECTED_RESEARCH_SHA256)throw new Error('The proposer changed the frozen live research snapshot.');
          await writeJSON(dataPath(target.directory,target.name),record);imported++;
        }
      }
      await visit();await output({imported});
    }else if(command==='seed'){
      const baselineRules=await fs.readFile(path.join(ROOT,'RULES.md'),'utf8'),health=[];
      const sources=await scanSources(s=>health.push(s));
      const githubRunUrl=process.env.GITHUB_REPOSITORY?`https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`:null;
      const research={id:runId,runId,createdAt:new Date().toISOString(),sources,health:structuredClone(health),githubRunUrl};
      await writeJSON(dataPath('research',runId),research,{immutable:true});
      const posts=await records('posts'),drafts=await records('drafts');
      const priorProducts=new Set([...posts,...drafts.flatMap(d=>d.posts||[])].map(p=>p.productUrl).filter(Boolean));
      const possibilities=sources.filter(s=>s.productUrl||/official/i.test(s.publisher)).map(s=>({source:s,productUrl:s.productUrl||s.url}));
      possibilities.sort((a,b)=>hash(runId+a.productUrl).localeCompare(hash(runId+b.productUrl)));
      const candidates=[],verified=[],seen=new Set();
      for(const {source,productUrl} of possibilities){
        if(candidates.length>=3)break;
        if(priorProducts.has(productUrl)||seen.has(productUrl))continue;
        try{
          const page=await fetchPublic(productUrl),text=plainText(page.text).slice(0,18000);
          if(text.length<300)continue;
          const sourceId=hash(productUrl),candidateId=candidateIdentity({productUrl});
          verified.push({id:sourceId,url:productUrl,title:source.title,publisher:new URL(productUrl).hostname,text,fetchedAt:page.fetchedAt,verifiedAt:page.fetchedAt});
          candidates.push({candidateId,title:source.title,productUrl,sourceIds:[sourceId],heldOut:true,excludedFromPublishedAndDrafted:true});seen.add(productUrl);
        }catch(error){health.push({name:source.title,url:productUrl,status:'failed',fetchedAt:new Date().toISOString(),items:0,message:safeError(error)});}
      }
      let metrics;try{metrics=await readJSON(path.join(ROOT,'metrics.json'));}catch(error){if(error.code!=='ENOENT')throw error;metrics={site:{status:'not_connected',views:null,saves:null},social:{status:'not_connected'},measuredAt:null};}
      const input={runId,createdAt:new Date().toISOString(),baselineRules,rulesSha256:sha256(baselineRules),sources:verified,sourceSnapshotSha256:sha256(stableJSON(verified)),selectionHealth:health,candidates,metrics,githubRunUrl};
      await writeJSON(dataPath('improvements',runId+'-input'),input,{immutable:true});
      await context({runId,role:'improver',inputPath:`data/improvements/${runId}-input.json`,proposalPath:`data/improvements/${runId}.json`});
      await output({ready:String(candidates.length>=3),candidates:candidates.length,inputSha256:sha256(stableJSON(input)),researchSha256:sha256(stableJSON(research))});
    }else if(command==='trial'){
      if(!['baseline','proposal'].includes(variant))throw new Error('Trial variant must be baseline or proposal.');
      const input=await readJSON(dataPath('improvements',runId+'-input')),proposal=await readJSON(dataPath('improvements',runId));
      const reasons=validateRuleProposal(input.baselineRules,proposal);if(reasons.length)throw new Error(reasons.join(' '));
      const trialId=hash(runId+variant);
      // Trial agents see only their assigned rules, never the alternative or label.
      await writeJSON(path.join(ROOT,'.run','trial-input.json'),{runId,trialId,rules:variant==='baseline'?input.baselineRules:proposal.newRules,candidates:input.candidates,sources:input.sources});
      await context({runId,role:'trial',trialId,inputPath:'.run/trial-input.json',outputPath:`data/improvements/${runId}-trial-${variant}.json`});
      await output({trialId});
    }else if(command==='blind'){
      const input=await readJSON(dataPath('improvements',runId+'-input')),proposal=await readJSON(dataPath('improvements',runId));
      const baseline=await readJSON(dataPath('improvements',runId+'-trial-baseline')),challenger=await readJSON(dataPath('improvements',runId+'-trial-proposal'));
      const cases=[],mapping=[];
      for(const candidate of input.candidates){
        const toTrial=record=>{const raw=record.posts?.find(p=>p.productUrl===candidate.productUrl),post=raw?{...raw,id:candidate.candidateId,candidateId:candidate.candidateId}:null;return {post,refusal:record.refusals?.find(r=>r.candidateId===candidate.candidateId)?.reason||null,deterministicReasons:post?deterministicCheck(post,input.sources):['Trial produced no draft.']};};
        const reversed=randomInt(2)===1;
        cases.push({candidateId:candidate.candidateId,productUrl:candidate.productUrl,sources:input.sources.filter(s=>candidate.sourceIds.includes(s.id)),A:toTrial(reversed?challenger:baseline),B:toTrial(reversed?baseline:challenger)});
        mapping.push({candidateId:candidate.candidateId,baseline:reversed?'B':'A',proposal:reversed?'A':'B'});
      }
      const blind={runId,sourceSnapshotSha256:input.sourceSnapshotSha256,trialsSha256:sha256(stableJSON(cases)),cases};
      await writeJSON(dataPath('improvements',runId+'-labels'),{runId,proposalSha256:sha256(stableJSON(proposal)),cases:mapping},{immutable:true});
      await writeJSON(dataPath('improvements',runId+'-blind'),blind,{immutable:true});
      await writeJSON(path.join(ROOT,'.run','blind','context.json'),blind);
      await fs.copyFile(path.join(ROOT,'.github','codex','prompts','grader.md'),path.join(ROOT,'.run','blind','PROMPT.md'));
      await output({cases:cases.length,trialsSha256:blind.trialsSha256});
    }else throw new Error('Use gate, seed, trial, or blind.');
  }
}catch(error){console.error(safeError(error));process.exitCode=1;}
