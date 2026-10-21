import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT} from '../lib/storage.mjs';
import {readBoundedJSON} from '../lib/source-registry.mjs';
import {sealedWriterCoverage} from '../lib/writer-coverage.mjs';

const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
// Read-only advice within the existing writer/repair model turn. The later
// checker invokes the shared validator using its own independently sealed pins.
export async function checkWriterCoverage({runId,root=ROOT,env=process.env}={}){
 if(!/^loop-[1-9]\d{0,15}-[1-9]\d{0,3}$/.test(runId||''))throw new Error('Writer coverage requires an exact loop run ID.');
 let researchSha256=env.EXPECTED_RESEARCH_SHA,selectionSha256=env.EXPECTED_LEARNING_SELECTION_SHA,pinSource='environment';
 if(researchSha256!==undefined||selectionSha256!==undefined){if(!hex(researchSha256)||!hex(selectionSha256))throw new Error('Both trusted writer coverage fingerprints are required.');}
 else{
  const context=await readBoundedJSON(path.join(root,'.run','context.json'),100000);
  if(context.runId!==runId||!['writer','repair'].includes(context.role)||!hex(context.writerCoverage?.researchSha256)||!hex(context.writerCoverage?.selectionSha256))throw new Error('Writer advisory context lacks its original discussion fingerprints.');
  researchSha256=context.writerCoverage.researchSha256;selectionSha256=context.writerCoverage.selectionSha256;pinSource='advisory_context';
 }
 const [research,selection,draft]=await Promise.all(['research','learning-selection','drafts'].map(directory=>readBoundedJSON(path.join(root,'data',directory,runId+'.json'),3000000)));
 const report=sealedWriterCoverage(draft,{runId,research,selection,expectedResearchSha256:researchSha256,expectedSelectionSha256:selectionSha256});
 return {...report,pinSource};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const report=await checkWriterCoverage({runId:process.argv[2]});console.log(JSON.stringify(report));if(!report.valid)process.exitCode=1;}
 catch{console.log(JSON.stringify({schema:1,kind:'writer_coverage',coverageOnly:true,valid:false,reasons:['Writer coverage could not read unchanged bounded original inputs and draft.']}));process.exitCode=1;}
}
