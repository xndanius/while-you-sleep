import {personalDataReasons} from './demand.mjs';

const sensitiveKeys=new Set(['email','email_address','phone','telephone','mobile','contact','contactpoint','contact_point','personal_name','personname','first_name','last_name','firstname','lastname','ssn','patient','patient_id','applicant','profile','employer','person_id','author']);
export function privateArtifactReasons(value){
 const reasons=personalDataReasons(value);
 function visit(item){if(!item||typeof item!=='object')return;if(Array.isArray(item)){for(const child of item)visit(child);return;}for(const [key,child] of Object.entries(item)){if(sensitiveKeys.has(key.toLowerCase()))reasons.push('Personal/contact/profile fields are forbidden in stored content artifacts.');visit(child);}}
 visit(value);if(/\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}/.test(JSON.stringify(value)))reasons.push('Possible credential found in stored content artifact.');
 return [...new Set(reasons)];
}

const categories=new Map([
 ['Personal contact details must not be stored.','contact_pattern'],
 ['Possible personal telephone details must not be stored.','telephone_pattern'],
 ['Personal street addresses must not be stored.','address_pattern'],
 ['Personal usernames must not be stored.','username_pattern'],
 ['Personal/contact/profile fields are forbidden in stored content artifacts.','prohibited_field'],
 ['Possible credential found in stored content artifact.','credential_pattern']
]);
export const PRIVACY_CATEGORIES=Object.freeze([...categories.values()]);
export function privateArtifactCategories(value){return privateArtifactReasons(value).map(reason=>categories.get(reason));}
