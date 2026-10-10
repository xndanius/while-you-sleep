import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm, chmod, stat, readdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installEncryptedSecret } from '../scripts/install-encrypted-openai-secret.mjs';

const {subtle}=webcrypto;
const fictional=Buffer.from('sk-proj-FICTIONAL_TEST_VALUE_not_an_actual_api_key_123');
const pairPromise=subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);
async function fixture({value=fictional,exitCode=0}={}) {
  const root=await mkdtemp(path.join(os.tmpdir(),'wys-encrypted-secret-test-'));
  const pair=await pairPromise;
  const privateKeyPath=path.join(root,'recipient-private-key.jwk.json');
  await writeFile(privateKeyPath,JSON.stringify(await subtle.exportKey('jwk',pair.privateKey)),{mode:0o600});
  const encrypted=await subtle.encrypt({name:'RSA-OAEP'},pair.publicKey,value);
  const ciphertext=Buffer.from(encrypted).toString('base64url');
  const gh=path.join(root,'gh');
  await writeFile(gh,`#!${process.execPath}\nconst fs=require('node:fs');const crypto=require('node:crypto');const chunks=[];process.stdin.on('data',x=>chunks.push(x));process.stdin.on('end',()=>{const value=Buffer.concat(chunks);fs.writeFileSync(process.env.MOCK_RECEIPT,JSON.stringify({hash:crypto.createHash('sha256').update(value).digest('hex'),args:process.argv.slice(2),host:process.env.GH_HOST,openaiEnvPresent:!!process.env.OPENAI_API_KEY,codexEnvPresent:!!process.env.CODEX_API_KEY}));console.log(value.toString());console.error(value.toString());value.fill(0);process.exit(${exitCode});});\n`,{mode:0o700});
  const receipt=path.join(root,'receipt.json');
  const env={PATH:root+path.delimiter+path.dirname(process.execPath),MOCK_RECEIPT:receipt,GH_HOST:'unapproved-host.example',OPENAI_API_KEY:'fictional-inherited-model-key',CODEX_API_KEY:'fictional-inherited-codex-key'};
  return {root,privateKeyPath,ciphertext,env,receipt};
}

test('matches plugin WebCrypto encryption and pipes fictional key only to fixed Actions secret',async()=>{
  const f=await fixture();
  try {
    const result=await installEncryptedSecret(f);
    assert.equal(result.installed,true);
    const receipt=JSON.parse(await readFile(f.receipt,'utf8'));
    assert.equal(receipt.hash,createHash('sha256').update(fictional).digest('hex'));
    assert.deepEqual(receipt.args,['secret','set','OPENAI_API_KEY','--repo','xndanius/while-you-sleep','--app','actions']);
    assert.equal(receipt.openaiEnvPresent,false);
    assert.equal(receipt.codexEnvPresent,false);
    assert.equal(receipt.host,'github.com');
    await assert.rejects(()=>stat(f.privateKeyPath),{code:'ENOENT'});
    assert.equal((await readdir(f.root)).some(name=>name.startsWith('.env')),false);
    assert.equal(JSON.stringify(result).includes(fictional.toString()),false);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('CLI suppresses even a mock GitHub CLI that echoes the fictional plaintext',async()=>{
  const f=await fixture();
  try{
    const script=fileURLToPath(new URL('../scripts/install-encrypted-openai-secret.mjs',import.meta.url));
    const output=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[script,'--private-key',f.privateKeyPath,'--ciphertext',f.ciphertext],{env:f.env,stdio:['ignore','pipe','pipe']});
      let stdout='',stderr='';child.stdout.on('data',value=>stdout+=value);child.stderr.on('data',value=>stderr+=value);
      child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));
    });
    assert.equal(output.code,0);
    assert.equal(JSON.parse(output.stdout).destination,'GitHub Actions');
    assert.equal(output.stdout.includes(fictional.toString()),false);
    assert.equal(output.stderr,'');
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('failed GitHub transfer retains recipient key and exposes only a fixed safe error',async()=>{
  const f=await fixture({exitCode:1});
  try{
    await assert.rejects(()=>installEncryptedSecret(f),error=>error.message==='GitHub secret transfer failed; temporary recipient key was retained.'&&!error.message.includes(fictional.toString()));
    assert.equal((await stat(f.privateKeyPath)).isFile(),true);
    assert.equal((await readdir(f.root)).some(name=>name.startsWith('.env')),false);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('connector result wrappers work; unsupported versions fail before GitHub execution',async()=>{
  for(const wrapper of ['encrypted_api_key','structuredContent','structured_content']){
    const f=await fixture();
    try{
      const encryptedResultPath=path.join(f.root,'encrypted-result.json');
      const payload={version:1,ciphertext:f.ciphertext};
      await writeFile(encryptedResultPath,JSON.stringify(wrapper==='encrypted_api_key'?{encrypted_api_key:payload}:{[wrapper]:{encrypted_api_key:payload}}));
      assert.equal((await installEncryptedSecret({...f,ciphertext:undefined,encryptedResultPath})).installed,true);
    }finally{await rm(f.root,{recursive:true,force:true});}
  }
  const f=await fixture();
  try{
    const encryptedResultPath=path.join(f.root,'encrypted-result.json');
    await writeFile(encryptedResultPath,JSON.stringify({encrypted_api_key:{version:2,ciphertext:f.ciphertext}}));
    await assert.rejects(()=>installEncryptedSecret({...f,ciphertext:undefined,encryptedResultPath}),/version is unsupported/);
    await assert.rejects(()=>stat(f.receipt),{code:'ENOENT'});
    assert.equal((await stat(f.privateKeyPath)).isFile(),true);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('bad ciphertext and decrypted newline injection cannot reach GitHub',async()=>{
  const f=await fixture();
  try{
    await assert.rejects(()=>installEncryptedSecret({...f,ciphertext:'invalid ciphertext'}),/ciphertext is invalid/);
    await assert.rejects(()=>stat(f.receipt),{code:'ENOENT'});
  }finally{await rm(f.root,{recursive:true,force:true});}
  const injection=await fixture({value:Buffer.from('sk-proj-fictional\nANOTHER_SECRET=injected')});
  try{
    await assert.rejects(()=>installEncryptedSecret(injection),/safe OpenAI API key literal/);
    await assert.rejects(()=>stat(injection.receipt),{code:'ENOENT'});
  }finally{await rm(injection.root,{recursive:true,force:true});}
});

test('recipient key symlinks and broadly readable permissions fail closed',async()=>{
  const f=await fixture();
  try{
    const link=path.join(f.root,'linked-private-key.json');await symlink(f.privateKeyPath,link);
    await assert.rejects(()=>installEncryptedSecret({...f,privateKeyPath:link}),/safely read/);
    await chmod(f.privateKeyPath,0o644);
    await assert.rejects(()=>installEncryptedSecret(f),/safely read/);
    await assert.rejects(()=>stat(f.receipt),{code:'ENOENT'});
  }finally{await rm(f.root,{recursive:true,force:true});}
});
