import {appendFile} from 'node:fs/promises';
import {dataPath,writeJSON} from '../lib/storage.mjs';

const expiresAt='2026-10-10T13:58:00.000Z';
const now=new Date();
if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_EVENT_NAME!=='schedule'||process.env.GITHUB_REPOSITORY!=='xndanius/while-you-sleep'||!/^\d+$/.test(process.env.GITHUB_RUN_ID||'')||!/^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT||''))throw Error('Only an actual scheduled GitHub run may record this probe.');
if(now.getTime()>Date.parse(expiresAt)){
  if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'recorded=false\n');
  console.log('Temporary schedule probe expired; no publication was attempted.');
}else{
  const id=`probe-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  const record={id,kind:'probe',eventName:'schedule',createdAt:now.toISOString(),githubRunUrl:`https://github.com/xndanius/while-you-sleep/actions/runs/${process.env.GITHUB_RUN_ID}`,cron:'3,13,23,33,43,53 * 10 10 *',expiresAt,published:false,message:'A real GitHub schedule event reached a hosted runner. This probe does not write posts and is not publication proof.'};
  await writeJSON(dataPath('scheduler',id),record,{immutable:true});
  if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'recorded=true\n');
  console.log(JSON.stringify(record));
}
