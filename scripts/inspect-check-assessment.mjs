import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT,sha256,stableJSON} from '../lib/storage.mjs';
import {readBoundedJSON} from '../lib/source-registry.mjs';
import {checkerAssessmentView} from '../lib/checker-assessment.mjs';

const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

// Read-only within the existing checker turn. This verifies the reading aid's
// integrity, not whether a model understood it or whether any post may publish.
export async function inspectCheckAssessment({runId,root=ROOT,env=process.env}={}){
 if(!/^loop-[1-9]\d{0,15}-[1-9]\d{0,3}$/.test(runId||''))throw new Error('Checker assessment needs an exact loop run ID.');
 const session=await readBoundedJSON(path.join(root,'.run/context.json'),1000000);
 if(session.runId!==runId||!['checker','final-checker'].includes(session.role)||session.checkerAssessment?.path!=='.run/checker-assessment.json'||!hex(session.checkerAssessment?.sha256)||!hex(session.checkContextSha256))throw new Error('Checker assessment reading context is unavailable.');
 const [draft,context,saved]=await Promise.all([
  readBoundedJSON(path.join(root,'data/drafts',runId+'.json'),3000000),
  readBoundedJSON(path.join(root,'data/check-context',runId+'.json'),3000000),
  readBoundedJSON(path.join(root,'.run/checker-assessment.json'),6000000),
 ]);
 if(sha256(stableJSON(context))!==session.checkContextSha256)throw new Error('Checker assessment context changed.');
 for(const [key,actual] of [['EXPECTED_DRAFT_SHA',context.draftSha256],['EXPECTED_CONTEXT_SHA',session.checkContextSha256]])if(env[key]!==undefined&&(!hex(env[key])||env[key]!==actual))throw new Error('Checker assessment does not match the external fingerprint.');
 const view=checkerAssessmentView(draft,context,{role:session.role});
 if(sha256(stableJSON(view))!==session.checkerAssessment.sha256||stableJSON(saved)!==stableJSON(view)||stableJSON(session.checkerAssessment.counts)!==stableJSON(view.counts))throw new Error('Checker assessment reading inventory changed.');
 return view;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{console.log(JSON.stringify(await inspectCheckAssessment({runId:process.argv[2]})));}
 catch{console.log(JSON.stringify({schema:1,kind:'checker_assessment_view',advisoryOnly:true,available:false,reason:'Cannot read the complete unchanged privacy-safe checker assessment inputs.'}));process.exitCode=1;}
}
