import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT,records} from '../lib/storage.mjs';
import {effectiveUsageRecords,usageCountersComplete} from '../lib/usage.mjs';
const start='<!-- MODEL_COSTS_START -->',end='<!-- MODEL_COSTS_END -->';
export async function updateCostReadme({root=ROOT,usageRecords}={}) {
const groups=new Map();
for(const record of effectiveUsageRecords(usageRecords || await records('usage'))){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(record.localDate||''))continue;
 const values=groups.get(record.localDate)||[];values.push(record);groups.set(record.localDate,values);
}
const dates=[...groups.keys()].sort().reverse().slice(0,14);
const rows=dates.map(date=>{
 const runs=groups.get(date),costs=runs.map(r=>r.costUsd);
 const complete=costs.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0);
 const estimate=complete?`$${costs.reduce((a,b)=>a+b,0).toFixed(5)}`:'Unknown';
 const noModel=runs.filter(record=>usageCountersComplete(record)&&record.coverage.observedModelJobs===0).length;
 const coverage=!complete?'Missing or partial counters':noModel===runs.length?'Verified no model execution':noModel?'Reported counters and verified skipped models':'Reported CLI counters';
 return `| ${date} | ${runs.length} | ${estimate} | ${coverage} |`;
});
const body=rows.length?`| Vilnius date | Cloud runs | Estimated USD | Coverage |\n| --- | ---: | ---: | --- |\n${rows.join('\n')}\n\nStandard-rate token estimates, not invoices. Unreported billing adjustments remain unknown. [Calculation and rates](docs/COSTS.md).`:'No model usage is recorded yet.';
const file=path.join(root,'README.md'),source=await readFile(file,'utf8');
const left=source.indexOf(start),right=source.indexOf(end);
if(left<0||right<left)throw new Error('README model-cost markers are missing.');
await writeFile(file,source.slice(0,left+start.length)+'\n\n'+body+'\n\n'+source.slice(right));
console.log('Updated the daily model-cost table from trusted cloud usage records.');
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await updateCostReadme();
