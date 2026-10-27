import {hash} from './storage.mjs';
import {nativeReadingContextReasons} from './native-reading-context.mjs';
import {privateArtifactReasons} from './privacy.mjs';

// Registry authority and assignment checks remain with the enclosing demand
// contract. Extra task text is usable only from the same fresh, sealed native
// original post, never a provider receipt, legacy example or joined spans.
export function nativeDemandQuoteSpans(source,{asOf=source?.verifiedAt}={}){
 const verified=Date.parse(source?.verifiedAt),at=Date.parse(asOf),posted=Date.parse(source?.postedAt);
 if(!source?.nativeReadingContext||source.role!=='demand'||source.demand!==true||source.enriched!==true||source.discussionMetadataVersion!==1||source.demandMetadataVersion!==1||source.demandKind!=='community_request'||!['discussion-post','demand-notice'].includes(source.evidenceKind)||typeof source.url!=='string'||source.id!==hash(source.url)||source.productUrl!==source.url||typeof source.text!=='string'||source.text.length<25||source.text.length>200||source.taskExcerptVersion!==2||!Array.isArray(source.taskExcerpts)||source.taskExcerpts.length!==1||source.taskExcerpts[0]!==source.text||source.providerEvidence||source.providerProofVerified||source.livePostRefetched===false||source.taskExample!==undefined)return [];
 if(privateArtifactReasons(source).length||source.text!==source.text.trim()||source.discussionBodyVersion!==undefined&&(source.discussionBodyVersion!==1||typeof source.title!=='string'||source.title.toLowerCase().startsWith(source.text.toLowerCase())))return [];
 if(!Number.isFinite(at)||!Number.isFinite(verified)||!Number.isFinite(posted)||verified>at||at-verified>3*3600000||source.fetchedAt!==source.verifiedAt||posted>verified+86400000||verified-posted>45*86400000||source.evidenceFetch?.complete!==true||source.evidenceFetch?.maxBytes!==2000000||Object.keys(source.evidenceFetch).length!==2||nativeReadingContextReasons(source).length)return [];
 return source.nativeReadingContext.spans.filter(span=>span.kind==='task'||span.kind==='context');
}

export function demandQuoteOccurs(source,quote,options={}){
 if(typeof quote!=='string'||!quote.length)return false;
 if(typeof source?.text==='string'&&source.text.includes(quote))return true;
 return nativeDemandQuoteSpans(source,options).some(span=>span.text.includes(quote));
}
