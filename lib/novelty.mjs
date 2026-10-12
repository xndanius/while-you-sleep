import {sha256,stableJSON,validId,canonicalURL} from './storage.mjs';

export const NOVELTY_WINDOW_DAYS=14;
const DAY=86400000;
const dimensions=['product','workflow','customer'];
const normal=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const stop=new Set(('a an and are as at be been by can could do does for from has have how if in into is it its may might of on or our than that the their then these this to using was were will with would your ai agent agents artificial intelligence automate automated automation autonomous beginner beginners build business businesses company companies customer customers daily example first human humans hypothesis hypothetical idea input inputs model models new output outputs person product project proposed real recurring review service services small source supplied student team teams test tool tools version workflow workflows working pay pays paying payment demand evidence establish established establishes not no only remain remains unproved proven setup maintenance page').split(' '));
const aliases={emails:'email',mail:'email',messages:'message',queries:'ticket',questions:'ticket',tickets:'ticket',requests:'ticket',correspondence:'message',responses:'reply',response:'reply',answers:'reply',answer:'reply',replies:'reply',compose:'draft',composes:'draft',drafts:'draft',drafting:'draft',classify:'triage',classifies:'triage',classification:'triage',classifier:'triage',categorize:'triage',categorise:'triage',categorizes:'triage',labels:'triage',label:'triage',sort:'triage',sorts:'triage',route:'triage',routes:'triage',routing:'triage',categorization:'triage',categorisation:'triage',shops:'shop',stores:'shop',store:'shop',merchants:'retailer',sellers:'retailer',retailers:'retailer',developers:'developer',programmers:'developer',programmer:'developer',engineers:'engineer',bookkeepers:'bookkeeper',accountants:'accountant',recruiters:'recruiter',teachers:'teacher',educators:'teacher',tutors:'teacher',architects:'architect',agencies:'agency',clinics:'clinic',meetings:'meeting',transcripts:'transcript',summarize:'summary',summarise:'summary',summaries:'summary',summarizes:'summary',summarises:'summary',receipts:'receipt',invoices:'invoice',extracts:'extract',extraction:'extract',extracting:'extract',documents:'document',docs:'document',documentation:'document',monitoring:'monitor',monitors:'monitor',detects:'detect',calls:'call',calling:'call',telephone:'phone',voice:'phone',qualifying:'qualify',qualification:'qualify'};
function tokens(text){return new Set(normal(text).split(' ').map(word=>aliases[word]||word).filter(word=>word.length>2&&!stop.has(word)));}
const intersect=(a,b)=>[...a].filter(value=>b.has(value));

const workflowPatterns=[
 ['support_inbox',/\b(?:support (?:inbox|email|message|ticket|question)|customer (?:service|support)|help ?desk|tickets?)\b/,/\b(?:triage|classif\w*|categor\w*|sort\w*|rout\w*|draft\w*|repl\w*|answer\w*)\b/],
 ['receipt_expenses',/\b(?:receipts?|expense reports?|bookkeep\w*)\b/,/\b(?:extract\w*|categor\w*|csv|export\w*|reconcil\w*)\b/],
 ['meeting_followup',/\b(?:meetings?|meeting minutes|call transcripts?)\b/,/\b(?:summar\w*|action items?|follow ups?|decisions?|minutes)\b/],
 ['voice_agent_tests',/\b(?:voice|phone|telephone|call) (?:agents?|bots?|tests?)\b/,/\b(?:tests?|scenarios?|assert\w*|pass fail|evaluat\w*)\b/],
 ['agent_documentation_audit',/\b(?:docs?|documentation)\b/,/\b(?:agents?|machine readable|audit\w*|readability)\b/],
 ['website_change_monitor',/\b(?:websites?|web pages?|webpages?|pages?|sites?)\b/,/\b(?:monitor\w*|detect\w*) (?:\w+ ){0,3}(?:changes?|updates?)\b/],
 ['sales_lead_qualification',/\b(?:sales leads?|prospects?|leads?)\b/,/\b(?:qualif\w*|scor\w*|rank\w*|prioriti\w*)\b/],
 ['invoice_collection',/\b(?:invoices?|overdue payments?|accounts receivable)\b/,/\b(?:chase|remind\w*|collect\w*|follow ups?)\b/],
 ['appointment_booking',/\b(?:appointments?|bookings?)\b/,/\b(?:schedul\w*|book\w*|calendar|reserv\w*)\b/],
 ['code_review',/\b(?:code|pull requests?|merge requests?)\b/,/\b(?:review\w*|bugs?|defects?|static analysis)\b/],
];
const customerPatterns=[
 ['online_retailers',/\b(?:(?:online|internet|web|e commerce) (?:shops?|stores?|retailers?|sellers?|merchants?)|(?:ecommerce|e commerce|shopify|woocommerce) (?:businesses?|brands?|shops?|stores?|retailers?|sellers?|merchants?))\b/],
 ['support_staff',/\b(?:(?:customer )?support|help ?desk|customer service|customer success) (?:teams?|agents?|staff|managers?|departments?)\b/],
 ['software_developers',/\b(?:developers?|programmers?|software engineers?|(?:software|engineering|development|coding) teams?)\b/],
 ['accounting_staff',/\b(?:bookkeepers?|accountants?|accounting (?:firms?|teams?|practices?)|finance teams?)\b/],
 ['recruiting_staff',/\b(?:recruiters?|recruiting (?:firms?|teams?|agencies?)|hiring managers?|human resources (?:teams?|staff))\b/],
 ['real_estate_agents',/\b(?:real estate|property) (?:agents?|brokers?|agencies?)\b/],
 ['teachers_tutors',/\b(?:teachers?|educators?|tutors?)\b/],
 ['architectural_practices',/\b(?:architects?|architectural (?:firms?|practices?|studios?))\b/],
 ['restaurant_operators',/\b(?:restaurants?|restaurant (?:owners?|operators?|managers?))\b/],
 ['marketing_agencies',/\b(?:marketing|advertising|ad) (?:agencies|agency|studios?|consultants?)\b/],
 ['content_creators',/\b(?:content creators?|newsletter writers?|bloggers?|video creators?|youtubers?)\b/],
 ['saas_operators',/\b(?:saas|software as a service) (?:founders?|operators?|teams?|businesses?|companies)\b/],
];
const genericBrands=new Set(['app','apps','ai','api','agent','agents','bot','chat','docs','help','support','inbox','tools','tool','workflow','automation','example','platform']);
function productKeys(raw){
 try{
  const url=new URL(raw),host=url.hostname.toLowerCase().replace(/^www\./,''),parts=url.pathname.toLowerCase().split('/').filter(Boolean);let key,brand;
  // A workflow template is its own project, not every project on the vendor's
  // domain. Its stable numeric ID survives title-slug and tracking aliases.
  if(host==='n8n.io'&&parts[0]==='workflows'&&parts.length>=2){const numeric=parts[1].match(/^(\d+)(?:-|$)/);key=numeric?`catalog:n8n:workflow:${numeric[1]}`:`url:${canonicalURL(raw)}`;}
  else if(host==='betalist.com'&&parts[0]==='startups'&&parts.length>=2){key=`catalog:betalist:startup:${parts[1]}`;brand=parts[1];}
  else if(['github.com','raw.githubusercontent.com'].includes(host)&&parts.length>=2){key=`github:${parts[0]}/${parts[1].replace(/\.git$/,'')}`;brand=parts[1].replace(/\.git$/,'');}
  else if(host==='huggingface.co'&&parts[0]==='spaces'&&parts.length>=3){key=`hf:${parts[1]}/${parts[2]}`;brand=parts[2];}
  else if(['producthunt.com','apps.shopify.com','marketplace.visualstudio.com','news.ycombinator.com','reddit.com','medium.com','huggingface.co','betalist.com','microlaunch.net','ycombinator.com','theresanaiforthat.com'].includes(host)){key=`url:${canonicalURL(raw)}`;}
  else if(/\.(?:github\.io|vercel\.app|netlify\.app|pages\.dev|hf\.space)$/.test(host)){key=`tenant:${host}`;brand=host.split('.')[0];}
  else{const labels=host.split('.'),country=/\.(?:co|com|org|net)\.[a-z]{2}$/.test(host);const domain=labels.slice(country?-3:-2).join('.');key=`domain:${domain}`;brand=labels[country?labels.length-3:labels.length-2];}
  const keys=[key],label=normal(brand).replace(/ /g,'');if(label.length>=4&&!genericBrands.has(label))keys.push(`brand:${label}`);return keys;
 }catch{return [];}
}
const workflowText=post=>[post.title,post.promise,...(Array.isArray(post.loop)?post.loop:[])].filter(value=>typeof value==='string').join(' ');
const customerText=post=>String(post.whoPays||'').split(';')[0].split(/\b(?:the supplied|the source|the page|demand (?:is|remains))\b/i)[0];
export function noveltyProfile(post){
 const workflow=normal(workflowText(post)),customer=normal(customerText(post));
 return {productKeys:productKeys(post.productUrl),workflowKeys:workflowPatterns.filter(([,object,action])=>object.test(workflow)&&action.test(workflow)).map(([key])=>key),customerKeys:customerPatterns.filter(([,pattern])=>pattern.test(customer)).map(([key])=>key)};
}
function similar(a,b,minimum){
 const shared=intersect(a,b).length;if(shared<minimum||Math.min(a.size,b.size)<minimum)return false;
 const union=a.size+b.size-shared;return shared/union>=0.7||(shared/Math.min(a.size,b.size)>=0.9&&Math.max(a.size,b.size)<=Math.min(a.size,b.size)*1.7);
}

export function recentPublishedPosts(previous,{now=new Date(),windowDays=NOVELTY_WINDOW_DAYS}={}){
 const at=new Date(now).getTime();if(!Number.isFinite(at)||windowDays!==NOVELTY_WINDOW_DAYS)throw new Error('Invalid novelty comparison window.');
 return previous.filter(post=>Number.isFinite(Date.parse(post?.publishedAt))&&Date.parse(post.publishedAt)>=at-windowDays*DAY&&Date.parse(post.publishedAt)<=at);
}
export function noveltyMatches(post,previous,{now=new Date()}={}){
 const profile=noveltyProfile(post),matches=[];
 for(const prior of recentPublishedPosts(previous,{now})){
  const other=noveltyProfile(prior),shared={product:intersect(new Set(profile.productKeys),new Set(other.productKeys)),workflow:intersect(new Set(profile.workflowKeys),new Set(other.workflowKeys)),customer:intersect(new Set(profile.customerKeys),new Set(other.customerKeys))};
  if(shared.product.length)matches.push({postId:prior.id,dimension:'product',reason:`same product family (${shared.product[0]})`});
  if(shared.workflow.length||similar(tokens(workflowText(post)),tokens(workflowText(prior)),5))matches.push({postId:prior.id,dimension:'workflow',reason:shared.workflow.length?`same workflow (${shared.workflow[0]})`:'strong overlap in the specific workflow text'});
  if(shared.customer.length||similar(tokens(customerText(post)),tokens(customerText(prior)),2))matches.push({postId:prior.id,dimension:'customer',reason:shared.customer.length?`same specific customer (${shared.customer[0]})`:'strong overlap in the specific customer description'});
 }
 return matches;
}
export function noveltyReasons(post,previous,options={}){
 return noveltyMatches(post,previous,options).map(match=>`Duplicate within 14 days: ${match.reason}; recent post ${match.postId}.`);
}
export function createNoveltyContext(previous,{now=new Date()}={}){
 const date=new Date(now),posts=recentPublishedPosts(previous,{now:date}).map(post=>({id:post.id,publishedAt:post.publishedAt,title:post.title,productUrl:post.productUrl,promise:post.promise,whatItIs:String(post.whatItIs||'').slice(0,700),whoPays:String(post.whoPays||'').slice(0,700),loop:Array.isArray(post.loop)?post.loop.slice(0,7).map(step=>String(step).slice(0,500)):[],profile:noveltyProfile(post)})).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)||a.id.localeCompare(b.id));
 return {version:1,windowDays:NOVELTY_WINDOW_DAYS,asOf:date.toISOString(),cutoff:new Date(date.getTime()-NOVELTY_WINDOW_DAYS*DAY).toISOString(),posts,postsSha256:sha256(stableJSON(posts))};
}
export function noveltyContextReasons(context){
 const memory=context?.noveltyContext;if(context?.noveltyContractVersion!==1)return [];
 if(!memory||memory.version!==1||memory.windowDays!==14||!Array.isArray(memory.posts)||!Number.isFinite(Date.parse(memory.asOf))||memory.cutoff!==new Date(Date.parse(memory.asOf)-14*DAY).toISOString()||memory.postsSha256!==sha256(stableJSON(memory.posts)))return ['The frozen 14-day novelty context is missing or changed.'];
 if(new Set(memory.posts.map(post=>post.id)).size!==memory.posts.length||memory.posts.some(post=>!validId(post.id)||typeof post.productUrl!=='string'||!Number.isFinite(Date.parse(post.publishedAt))||Date.parse(post.publishedAt)<Date.parse(memory.cutoff)||Date.parse(post.publishedAt)>Date.parse(memory.asOf)))return ['The frozen novelty index contains an invalid recent published-post identity or date.'];
 return [];
}
export function noveltyAssessmentReasons(check,context){
 if(context?.noveltyContractVersion!==1)return [];
 const failures=noveltyContextReasons(context);if(failures.length)return failures;
 const memory=context.noveltyContext,verdict=check?.noveltyCheck;
 const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
 if(!exact(verdict,['recentPostsSha256','windowDays','comparedPostCount',...dimensions])||verdict.recentPostsSha256!==memory.postsSha256||verdict.windowDays!==14||verdict.comparedPostCount!==memory.posts.length)return ['Independent novelty verdict does not bind the complete frozen 14-day index.'];
 for(const dimension of dimensions){
  const part=verdict[dimension];
  const identityValid=memory.posts.length?memory.posts.some(post=>post.id===part?.closestPostId):part?.closestPostId===null;
  if(!exact(part,['distinct','closestPostId','reason'])||typeof part.distinct!=='boolean'||typeof part.reason!=='string'||!part.reason.trim()||part.reason.length>500||/[\r\n]/.test(part.reason)||!identityValid)failures.push(`Independent ${dimension} novelty comparison is missing or malformed.`);
 }
 return [...new Set(failures)];
}
export function noveltyApprovalReasons(check,context){
 const failures=noveltyAssessmentReasons(check,context);if(failures.length||context?.noveltyContractVersion!==1)return failures;
 for(const dimension of dimensions)if(check.noveltyCheck[dimension].distinct!==true)failures.push(`Independent checker found a recent duplicate ${dimension}.`);
 return failures;
}
