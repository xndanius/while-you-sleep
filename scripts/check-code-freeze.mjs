import {assertCodeFreeze} from '../lib/code-freeze.mjs';
import {safeError} from '../lib/storage.mjs';
try {console.log(JSON.stringify(await assertCodeFreeze()));}
catch(error) {console.error(safeError(error));process.exitCode=1;}
