import {promises as fs} from 'node:fs';
import path from 'node:path';
const from=path.resolve(process.argv[2]||'.staging/data');
const runId=process.argv[3];
if(!/^[a-zA-Z0-9_-]+$/.test(runId||''))throw new Error('A bounded run ID is required');
const allowed=new Set(['research','drafts','checks','check-context']);
async function visit(relative=''){
 for(const entry of await fs.readdir(path.join(from,relative),{withFileTypes:true})){
  const next=path.join(relative,entry.name);const parts=next.split(path.sep);
  if(entry.isSymbolicLink())throw new Error('Artifact symlinks are forbidden');
  if(!allowed.has(parts[0]))throw new Error('Unexpected artifact directory');
  if(entry.isDirectory()){if(parts.length!==1)throw new Error('Nested artifact directories are forbidden');await visit(next);continue}
  if(!entry.isFile()||parts.length!==2||!/^[-a-zA-Z0-9_.]+\.json$/.test(entry.name))throw new Error('Unexpected artifact file');
  if(![`${runId}.json`,`${runId}-first.json`].includes(entry.name))throw new Error('Artifact belongs to a different run');
  const bytes=await fs.readFile(path.join(from,next));
  if(bytes.length>2500000)throw new Error('Artifact record is too large');
  const text=bytes.toString('utf8');JSON.parse(text);
  if(/\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}/.test(text))throw new Error('Possible credential found in data; publication blocked');
  await fs.mkdir(path.join('data',parts[0]),{recursive:true});
  await fs.writeFile(path.join('data',next),bytes);
 }
}
await visit();console.log('Imported bounded JSON data artifacts.');
