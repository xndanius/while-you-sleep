// New assistant publications are website-only. Absence retains the historical
// RSS contract; an explicit or unrecognised scope can never opt into a relay.
export const WEBSITE_ONLY=Object.freeze({website:true,rss:false,social:false});
export function websiteOnly(scope){
 return !!scope&&Object.keys(scope).length===3&&scope.website===true&&scope.rss===false&&scope.social===false;
}
export function rssEligible(post){
 return post?.distribution===undefined&&post?.assistantExecution===undefined&&post?.origin!=='assistant-checked-publication';
}
