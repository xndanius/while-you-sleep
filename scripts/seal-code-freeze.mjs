import {sealCodeFreeze} from '../lib/code-freeze.mjs';
const args=process.argv.slice(2);
if(args.some(arg=>arg!=='--replace-before-freeze'))throw new Error('Unsupported freeze sealing option.');
const record=await sealCodeFreeze({replaceBeforeFreeze:args.includes('--replace-before-freeze')});
console.log(JSON.stringify({id:record.id,codeSha256:record.codeSha256,files:Object.keys(record.files).length,replaces:record.replaces||null}));
