import {promises as fs} from 'node:fs';
import path from 'node:path';

// The cadence retains its original activation history. Actual relay readiness
// comes from the latest human report, including corrections of earlier reports.
export function relayPublicationReady(status,{hourly=true}={}) {
  if(!hourly)return true;
  const confirmed=status?.bestFeedSwitch?.confirmedAt;
  return status?.feedPath==='best.xml'&&status?.bestFeedSwitch?.state==='confirmed'
    &&typeof confirmed==='string'&&Number.isFinite(Date.parse(confirmed));
}
export async function readRelayStatus(root) {
  const file=path.join(root,'data','relay','status.json'),stat=await fs.lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32000)throw new Error('Relay status must be a bounded regular record.');
  return JSON.parse(await fs.readFile(file,'utf8'));
}
