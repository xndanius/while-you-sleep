import { constants as cryptoConstants, createPrivateKey, privateDecrypt } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open, lstat, realpath, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY='xndanius/while-you-sleep';
const SECRET_NAME='OPENAI_API_KEY';
const MAX_INPUT_BYTES=32*1024;

async function readInput(file,{privateFile=false}={}) {
  if(typeof file!=='string'||!path.isAbsolute(file))throw new Error('An absolute input path is required.');
  const resolved=path.join(await realpath(path.dirname(file)),path.basename(file));
  let handle,buffer;
  try {
    handle=await open(resolved,fsConstants.O_RDONLY|(fsConstants.O_NOFOLLOW||0));
    const stat=await handle.stat();
    if(!stat.isFile()||stat.nlink!==1||stat.size<1||stat.size>MAX_INPUT_BYTES)throw new Error('Input must be a bounded regular file without links.');
    if(privateFile&&((stat.mode&0o077)!==0||(process.getuid&&stat.uid!==process.getuid())))throw new Error('Private key ownership or permissions are unsafe.');
    buffer=Buffer.alloc(MAX_INPUT_BYTES+1);
    let length=0;
    while(length<buffer.length){
      const {bytesRead}=await handle.read(buffer,length,buffer.length-length,length);
      if(!bytesRead)break;
      length+=bytesRead;
    }
    if(length>MAX_INPUT_BYTES)throw new Error('Input exceeds its size limit.');
    return {buffer:buffer.subarray(0,length),file:resolved,identity:{dev:stat.dev,ino:stat.ino}};
  } catch {
    buffer?.fill(0);
    throw new Error(privateFile?'Could not safely read the recipient private key.':'Could not safely read the encrypted result.');
  } finally {await handle?.close();}
}

function payloadFromResult(bytes) {
  let raw;
  try{raw=JSON.parse(bytes.toString('utf8'));}catch{throw new Error('Encrypted result is invalid JSON.');}
  const payload=raw?.encrypted_api_key??raw?.structuredContent?.encrypted_api_key??raw?.structured_content?.encrypted_api_key;
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('Encrypted result does not contain the expected payload.');
  return payload;
}

function ciphertextBytes(payload) {
  const ciphertext=payload?.ciphertext;
  if(payload?.version!==1)throw new Error('Encrypted key version is unsupported.');
  if(typeof ciphertext!=='string'||ciphertext.length>8192||!/^[A-Za-z0-9_-]+$/.test(ciphertext)||ciphertext.length%4===1)throw new Error('Encrypted ciphertext is invalid.');
  const bytes=Buffer.from(ciphertext,'base64url');
  if(bytes.length<128||bytes.length>1024||bytes.toString('base64url')!==ciphertext){bytes.fill(0);throw new Error('Encrypted ciphertext is invalid.');}
  return bytes;
}

function safeKeyBuffer(bytes) {
  // Validate without converting the plaintext API key to an immutable JS string.
  if(!Buffer.isBuffer(bytes)||bytes.length<4||bytes.length>1024||bytes[0]!==115||bytes[1]!==107||bytes[2]!==45)return false;
  for(let i=3;i<bytes.length;i++){
    const c=bytes[i];
    if(!((c>=48&&c<=57)||(c>=65&&c<=90)||(c>=97&&c<=122)||c===45||c===95))return false;
  }
  return true;
}

function setActionsSecret(bytes,{env=process.env,timeoutMs=30_000}={}) {
  return new Promise((resolve,reject)=>{
    const childEnv={...env,GH_PROMPT_DISABLED:'1',GH_HOST:'github.com'};
    // No model key or debug setting needs to enter the GitHub CLI environment.
    for(const key of ['OPENAI_API_KEY','CODEX_API_KEY','GH_DEBUG','GODEBUG'])delete childEnv[key];
    const child=spawn('gh',['secret','set',SECRET_NAME,'--repo',REPOSITORY,'--app','actions'],{env:childEnv,stdio:['pipe','ignore','ignore']});
    let settled=false;
    const finish=error=>{
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      if(error)reject(error);else resolve();
    };
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(new Error('GitHub secret transfer timed out; temporary recipient key was retained.'));},timeoutMs);
    child.on('error',()=>finish(new Error('GitHub CLI could not start; temporary recipient key was retained.')));
    child.stdin.on('error',()=>{child.kill('SIGKILL');finish(new Error('GitHub secret transfer failed; temporary recipient key was retained.'));});
    child.on('close',code=>finish(code===0?null:new Error('GitHub secret transfer failed; temporary recipient key was retained.')));
    // No --body argument, shell expansion, env value, log, or plaintext file.
    child.stdin.end(bytes);
  });
}

async function removeRecipientKey(input) {
  try {
    const stat=await lstat(input.file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.dev!==input.identity.dev||stat.ino!==input.identity.ino)throw new Error('Changed private key file.');
    await unlink(input.file);
  } catch {
    const error=new Error('GitHub Actions secret was installed, but temporary recipient-key cleanup did not complete.');
    error.secretInstalled=true;
    throw error;
  }
}

export async function installEncryptedSecret({privateKeyPath,ciphertext,encryptedResultPath,env=process.env,timeoutMs}={}) {
  if((typeof ciphertext==='string')===(typeof encryptedResultPath==='string'))throw new Error('Provide exactly one encrypted ciphertext or encrypted-result file.');
  let recipient,resultInput,cipherBytes,plaintext,keyObject,privateJwk;
  try {
    recipient=await readInput(privateKeyPath,{privateFile:true});
    let payload;
    if(typeof ciphertext==='string')payload={version:1,ciphertext};
    else{resultInput=await readInput(encryptedResultPath);payload=payloadFromResult(resultInput.buffer);}
    cipherBytes=ciphertextBytes(payload);
    try {
      privateJwk=JSON.parse(recipient.buffer.toString('utf8'));
      keyObject=createPrivateKey({key:privateJwk,format:'jwk'});
      if(keyObject.asymmetricKeyType!=='rsa'||keyObject.asymmetricKeyDetails?.modulusLength<2048)throw new Error('Unsupported recipient key.');
      // Matches plugin helper RSA-OAEP/SHA-256, version 1, empty OAEP label.
      plaintext=privateDecrypt({key:keyObject,padding:cryptoConstants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},cipherBytes);
    } catch {throw new Error('Encrypted API key could not be decrypted.');}
    if(!safeKeyBuffer(plaintext))throw new Error('Decrypted value is not a safe OpenAI API key literal.');
    await setActionsSecret(plaintext,{env,timeoutMs});
    plaintext.fill(0);
    await removeRecipientKey(recipient);
    return {installed:true,repository:REPOSITORY,secretName:SECRET_NAME,destination:'GitHub Actions',privateKeyRemoved:true};
  } finally {
    plaintext?.fill(0);
    cipherBytes?.fill(0);
    resultInput?.buffer.fill(0);
    recipient?.buffer.fill(0);
    if(privateJwk&&typeof privateJwk==='object')for(const field of Object.keys(privateJwk))privateJwk[field]=null;
    privateJwk=null;
    keyObject=null;
  }
}

function parseArgs(argv) {
  const options={};
  const keys={'--private-key':'privateKeyPath','--ciphertext':'ciphertext','--encrypted-result':'encryptedResultPath'};
  for(let i=0;i<argv.length;i+=2){
    const key=keys[argv[i]];
    if(!key||Object.hasOwn(options,key)||typeof argv[i+1]!=='string'||(key!=='ciphertext'&&argv[i+1].startsWith('--')))throw new Error('Invalid installer arguments.');
    options[key]=argv[i+1];
  }
  return options;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  Promise.resolve().then(()=>installEncryptedSecret(parseArgs(process.argv.slice(2))))
    .then(result=>console.log(JSON.stringify(result)))
    .catch(error=>{console.error(error.secretInstalled?'Actions secret installed; recipient-key cleanup needs attention.':'Encrypted secret installation failed; no plaintext key was written or printed.');process.exitCode=1;});
}
