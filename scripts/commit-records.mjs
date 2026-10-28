import {spawnSync} from 'node:child_process';
import {readdir,readFile,appendFile} from 'node:fs/promises';
const kind=process.argv[2]||'loop',runId=process.argv[3]||'';
if(!/^[a-zA-Z0-9_.-]+$/.test(runId))throw new Error('Invalid run ID');
function git(args,optional=false){const r=spawnSync('git',args,{encoding:'utf8'});if(r.status!==0&&!optional)throw new Error(`Git operation failed: ${args[0]}`);return r.stdout||''}
let committed=false;
git(['config','user.name','While You Sleep loop']);git(['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);
async function files(dir){try{return(await readdir(dir)).filter(f=>f.endsWith('.json')).map(f=>`${dir}/${f}`)}catch{return[]}}
function commit(paths,message){if(!paths.length)return;git(['add','--',...paths]);if(git(['diff','--cached','--name-only']).trim()){git(['commit','-m',message]);committed=true;}}
for(const directory of ['scheduling','slot-reservations','slot-outcomes']){
 const matches=[];for(const file of await files(`data/${directory}`)){const record=JSON.parse(await readFile(file,'utf8'));if(record.runId===runId||record.settledByRunId===runId)matches.push(file);}
 commit(matches,`schedule: ${runId} · ${directory} trusted slot decision`);
}
for(const directory of ['source-scans','source-attributions'])commit((await files(`data/${directory}`)).filter(file=>file===`data/${directory}/${runId}.json`),`source record: ${runId} · ${directory} trusted evidence`);
for(const directory of ['learning-selection','learning','no-fresh-leads'])commit((await files(`data/${directory}`)).filter(file=>file===`data/${directory}/${runId}.json`),`learning: ${runId} · ${directory} trusted demand decision`);
for(const directory of ['research-intents','research-results'])commit((await files(`data/${directory}`)).filter(file=>file===`data/${directory}/${runId}.json`),`research continuation: ${runId} · ${directory} trusted acquisition record`);
commit((await files('data/check-diagnostics')).filter(file=>file===`data/check-diagnostics/${runId}.json`),`check diagnostics: ${runId} · sealed unavailable evidence`);
commit(await files('data/feedback/provenance'),`feedback: ${runId} · verified operator commit and blob provenance`);
commit((await files('data/research')).filter(p=>p.includes(runId)),`research: ${runId} · public sources and feed health`);
commit((await files('data/usage')).filter(p=>p===`data/usage/${runId}.json`),`usage: ${runId} · trusted cloud CLI token estimate`);
for(const p of ['data/drafts','data/candidates','data/check-context','data/checks'])commit((await files(p)).filter(f=>f.includes(runId)),`${p.split('/')[1]}: ${runId} · evidence and decision record`);
for(const file of (await files('data/rejections')).filter(f=>f.includes(runId))){const rejection=JSON.parse(await readFile(file,'utf8'));const reason=String(rejection.reason||'Independent check rejected this candidate').replace(/[\r\n]+/g,' ').slice(0,180);commit([file],`reject: ${runId} · ${reason}`)}
for(const file of await files('data/posts')){const post=JSON.parse(await readFile(file,'utf8'));if(post.runId===runId)commit([file,`public/cards/${post.id}.jpg`],`post: ${post.title} · independent check passed`)}
commit((await files('data/runs')).filter(p=>p.includes(runId)),`loop: ${runId} · final publication and rejection results`);
if(kind==='loop'){const costUpdate=spawnSync(process.execPath,['scripts/update-cost-readme.mjs'],{stdio:'inherit'});if(costUpdate.status!==0)throw new Error('Daily cost summary could not be updated');commit(['README.md'],`cost: ${runId} · daily token estimate and coverage`)}
// GitHub token pushes do not trigger on:push workflows; caller explicitly deploys Pages.
for(let attempt=0;attempt<3;attempt++){
 const pushed=spawnSync('git',['push','origin','HEAD:main'],{stdio:'inherit'});
 if(pushed.status===0){if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`committed=${committed}\n`);process.exit(0);}
 git(['pull','--rebase','origin','main']);
}
throw new Error('Could not push cloud records after three attempts');
