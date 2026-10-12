import {CODE_FREEZE,codeSnapshot,freezeRecordPath} from '../lib/code-freeze.mjs';
import {ROOT,writeJSON} from '../lib/storage.mjs';
if(Date.now()>=Date.parse(CODE_FREEZE.startsAt))throw new Error('The code freeze baseline must be sealed before 18:00 Vilnius on 12 October.');
const snapshot=await codeSnapshot();
await writeJSON(freezeRecordPath(ROOT),{schema:1,...CODE_FREEZE,sealedAt:new Date().toISOString(),...snapshot},{immutable:true});
console.log(JSON.stringify({id:CODE_FREEZE.id,codeSha256:snapshot.codeSha256,files:Object.keys(snapshot.files).length}));
