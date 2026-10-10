import {copyFile} from 'node:fs/promises';
import {dataPath,readJSON,writeJSON} from '../lib/storage.mjs';
const runId=process.argv[2];
for(const directory of ['drafts','checks','check-context'])await copyFile(dataPath(directory,runId),dataPath(directory,`${runId}-first`));
const draft=await readJSON(dataPath('drafts',runId));draft.repairAttempt=1;await writeJSON(dataPath('drafts',runId),draft);
