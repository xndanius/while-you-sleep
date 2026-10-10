import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const hash = value => createHash('sha256').update(String(value)).digest('hex').slice(0,24);
export const sha256 = value => createHash('sha256').update(String(value)).digest('hex');
export const id = prefix => `${prefix}-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`;
export function stableJSON(value) {
  if(Array.isArray(value))return '['+value.map(stableJSON).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>JSON.stringify(k)+':'+stableJSON(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export function validId(value) { return typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,160}$/.test(value); }
export function dataPath(directory,name) {
  if(!/^[a-z-]+$/.test(directory)||!validId(name))throw new Error('Invalid record path.');
  return path.join(ROOT,'data',directory,name+'.json');
}
export async function readJSON(file) { return JSON.parse(await fs.readFile(file,'utf8')); }
export async function writeJSON(file,value,{immutable=false}={}) {
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:immutable?'wx':'w'});
}
export async function records(directory) {
  const dir=path.join(ROOT,'data',directory);let files;
  try{files=await fs.readdir(dir);}catch(error){if(error.code==='ENOENT')return [];throw error;}
  return Promise.all(files.filter(x=>x.endsWith('.json')).sort().reverse().map(x=>readJSON(path.join(dir,x))));
}
export function canonicalURL(raw) {
  const url=new URL(raw);url.hash='';
  for(const key of [...url.searchParams.keys()])if(/^(utm_|ref$|fbclid$|gclid$)/i.test(key))url.searchParams.delete(key);
  return url.toString().replace(/\/$/,'');
}
export function candidateIdentity(candidate) { return hash(canonicalURL(candidate.productUrl || candidate.sources?.[0]?.url || candidate.url)); }
export function safeError(error) { return String(error?.message || 'Unknown error').replace(/(?:sk-|Bearer\s+)[A-Za-z0-9_.-]+/g,'[redacted]').slice(0,300); }
