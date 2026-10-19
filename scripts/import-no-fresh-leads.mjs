import {promises as fs} from 'node:fs';
import path from 'node:path';
import {ROOT,readJSON,writeJSON,safeError} from '../lib/storage.mjs';
import {noFreshLeadsReasons} from '../lib/no-fresh-leads.mjs';

try{
 const directory=process.argv[2],runId=process.argv[3];if(!directory||!/^loop-\d+-\d+$/.test(runId||''))throw new Error('Invalid no-lead artifact identity.');
 const names=await fs.readdir(directory);if(names.length!==1||names[0]!==runId+'.json')throw new Error('No-lead artifact must contain exactly its expected file.');
 const file=path.join(directory,names[0]),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>20000)throw new Error('No-lead artifact must be bounded ordinary JSON.');
 const record=await readJSON(file),scan=await readJSON(path.join(ROOT,'data/source-scans',runId+'.json')),selection=await readJSON(path.join(ROOT,'data/learning-selection',runId+'.json'));
 const reasons=noFreshLeadsReasons(record,{runId,schedulingSha256:process.env.LOOP_SCHEDULING_SHA,expectedSha256:process.env.EXPECTED_NO_FRESH_LEADS_SHA,scan,selection});if(reasons.length)throw new Error(reasons.join(' '));
 await writeJSON(path.join(ROOT,'data/no-fresh-leads',runId+'.json'),record,{immutable:true});console.log(JSON.stringify({runId,imported:true,decision:record.decision}));
}catch(error){console.error(safeError(error));process.exitCode=1;}
