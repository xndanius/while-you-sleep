import { promises as fs } from 'node:fs';
import path from 'node:path';
import { sha256,stableJSON } from './storage.mjs';

// One version covers the module graph: an unchanged entrypoint must still
// refetch when a shared cadence or clock parser changes beneath it.
const importPattern=/^(import[^\n]*?\bfrom\s*['"])(\.\/([a-z0-9-]+\.js))(?:\?v=[a-f0-9]{12})?(['"])/gm;
export async function versionBrowserAssets(root){
  const directory=path.join(root,'public');
  const names=(await fs.readdir(directory)).filter(name=>/^[a-z0-9-]+\.js$/.test(name)).sort();
  const modules=await Promise.all(names.map(async name=>{
    const source=await fs.readFile(path.join(directory,name),'utf8');
    return {name,source:source.replace(importPattern,(_all,prefix,target,_name,quote)=>prefix+target+quote)};
  }));
  const scriptVersion=sha256(stableJSON(modules)).slice(0,12);
  const styleVersion=sha256(await fs.readFile(path.join(directory,'styles.css'),'utf8')).slice(0,12);
  const known=new Set(names);
  const rendered=modules.map(module=>({name:module.name,source:module.source.replace(importPattern,(_all,prefix,target,name,quote)=>{
    if(!known.has(name))throw new Error('Browser import does not identify a public module.');
    return `${prefix}${target}?v=${scriptVersion}${quote}`;
  })}));
  for(const module of rendered)await fs.writeFile(path.join(directory,module.name),module.source);
  const versionHTML=html=>html.replace(/href="styles\.css(?:\?v=[a-f0-9]{12})?"/g,`href="styles.css?v=${styleVersion}"`).replace(/src="([a-z0-9-]+\.js)(?:\?v=[a-f0-9]{12})?"/g,(_all,name)=>{
    if(!known.has(name))throw new Error('Browser script does not identify a public module.');
    return `src="${name}?v=${scriptVersion}"`;
  });
  return {styleVersion,scriptVersion,versionHTML};
}
