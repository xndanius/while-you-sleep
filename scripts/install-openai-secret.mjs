import {readFile,unlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const target=path.resolve(process.argv[2]||path.join(root,'.env.local'));
if(!target.startsWith(root+path.sep))throw new Error('Secure transfer file must be inside this workspace');
const text=await readFile(target,'utf8');
const match=text.match(/^\s*OPENAI_API_KEY\s*=\s*(.*?)\s*$/m);
const value=match?.[1]?.replace(/^(['"])(.*)\1$/,'$2');
if(!value)throw new Error('Confirmed transfer file has no OPENAI_API_KEY');
const status=await new Promise((resolve,reject)=>{
 const child=spawn('gh',['secret','set','OPENAI_API_KEY','--repo','xndanius/while-you-sleep'],{stdio:['pipe','pipe','pipe']});
 child.stdout.resume();child.stderr.resume();child.on('error',reject);child.on('exit',resolve);child.stdin.end(value);
});
if(status!==0)throw new Error('GitHub secret installation failed; confirmed local transfer retained for retry.');
await unlink(target);
console.log('OPENAI_API_KEY installed in repository Actions secrets; local transfer file removed.');
