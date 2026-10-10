import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
async function check(path) {
 for (const entry of await readdir(path,{withFileTypes:true})) {
  const file=`${path}/${entry.name}`;
  if(entry.isDirectory()) await check(file);
  else if(/\.(?:js|mjs)$/.test(file)) {
   const p=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
   if(p.status!==0) process.exit(p.status||1);
  }
 }
}
for(const path of ['public','lib','integrations','scripts']) {
 try{await check(path)}catch(e){if(e.code!=='ENOENT')throw e}
}
console.log('JavaScript syntax checks passed.');
