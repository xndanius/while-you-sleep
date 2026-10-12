import {hash,canonicalURL} from './storage.mjs';
import {DEMAND_SOURCE_CATALOG} from './demand-sources.mjs';
const originals=[
 {name:'Hacker News · Show HN',kind:'hn',url:'https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=40&query=AI'},
 {name:'Hacker News · automation',kind:'hn',url:'https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=30&query=automation'},
 ...['SideProject','Entrepreneur','n8n','AI_Agents'].map(name=>({name:`Reddit · r/${name}`,kind:'rss',url:`https://www.reddit.com/r/${name}/new/.rss?limit=20`})),
 {name:'Product Hunt',kind:'rss',url:'https://www.producthunt.com/feed'},
 {name:'Indie Hackers',kind:'html',url:'https://www.indiehackers.com/'},
 {name:'TechCrunch · AI',kind:'rss',url:'https://techcrunch.com/category/artificial-intelligence/feed/'},
 {name:'n8n · official AI workflows',kind:'html',url:'https://n8n.io/ai/'},
 {name:'Apify · official platform',kind:'html',url:'https://apify.com/'},
 {name:'Browser Use · official project',kind:'html',url:'https://browser-use.com/'},
 {name:'Dify · official project',kind:'html',url:'https://dify.ai/'},
].map(value=>({...value,origin:'original-seed',reason:'Existing public research seed; hosted access and parser validation remain required.'}));
const requested=[
 ...['SaaS','microsaas','indiehackers','automation','LocalLLaMA','ChatGPTCoding'].map(name=>({name:`Reddit · r/${name}`,kind:'rss',url:`https://www.reddit.com/r/${name}/new/.rss?limit=20`})),
 {name:'GitHub · daily trending repositories',kind:'github-trending',url:'https://github.com/trending'},
 {name:'Hugging Face · trending public Spaces',kind:'hf-spaces',url:'https://huggingface.co/api/spaces?sort=trendingScore&direction=-1&limit=20'},
 {name:'YC · Launches',kind:'yc-launches',url:'https://www.ycombinator.com/launches'},
 {name:'BetaList · new products',kind:'betalist',url:'https://betalist.com/'},
 {name:'Microlaunch · new products',kind:'unparsed-listing',url:'https://microlaunch.net/'},
 {name:"There's An AI For That",kind:'html',url:'https://theresanaiforthat.com/'},
].map(value=>({...value,origin:'requested-seed',reason:'Requested source expansion; starts on probation only after successful hosted validation.'}));
const alternatives=[
 {name:'n8n · document extraction templates',kind:'n8n-workflows',url:'https://n8n.io/workflows/categories/document-extraction/',reason:'Public server-rendered workflow cards with exact template URLs and descriptions; user-contributed documentation supplies leads, never proof of deployed businesses or revenue.'},
 {name:'n8n · invoice processing templates',kind:'n8n-workflows',url:'https://n8n.io/workflows/categories/invoice-processing/',reason:'Public server-rendered invoice-processing workflow examples; each detail page must be independently fetched, and actual demand remains a hypothesis.'},
 {name:'Hacker News · small customer-support products',kind:'hn',url:'https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=20&restrictSearchableAttributes=title&query=customer%20support',reason:'Narrow public launch search for support inboxes and bounded customer-service tools; title selection supplies leads, never proof of customers or autonomy.'},
 {name:'Hacker News · document products',kind:'hn',url:'https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=20&restrictSearchableAttributes=title&query=document',reason:'Narrow public launch search for document extraction and processing products; their capabilities require separate primary evidence.'},
 {name:'Hugging Face · invoice workflow demos',kind:'hf-spaces',url:'https://huggingface.co/api/spaces?search=invoice&sort=lastModified&direction=-1&limit=20',reason:'Public invoice extraction, validation and viewing demos as bounded workflow leads; listing alone proves no runtime, buyers, revenue or autonomy.'},
 {name:'Hacker News · Launch HN',kind:'hn-launches',url:'https://news.ycombinator.com/launches',reason:'Public launch discussion list; distinct from the currently script-only YC Launches page.'},
 {name:'YC · AI company directory',kind:'yc-directory',url:'https://www.ycombinator.com/companies/industry/artificial-intelligence',reason:'Public maker directory, not a launch feed; company evidence must be independently checked.'},
 {name:'Simon Willison · public AI notes',kind:'rss',url:'https://simonwillison.net/atom/everything/',reason:'Public Atom feed with attributable AI/product experiments.'},
 {name:'Latent Space · public newsletter',kind:'rss',url:'https://www.latent.space/feed',reason:'Public newsletter RSS; only complete bounded public entries are eligible.'},
 {name:'Ben’s Bites · public newsletter',kind:'rss',url:'https://www.bensbites.com/feed',reason:'Public newsletter RSS; paid or login-only evidence is never fetched.'},
].map(value=>({...value,origin:'public-feed-proposal'}));
export const sourceSeedCatalog=Object.freeze([...DEMAND_SOURCE_CATALOG.map(value=>({...value,origin:'demand-seed'})),...originals,...requested,...alternatives].map(value=>Object.freeze({...value,url:canonicalURL(value.url),id:hash(canonicalURL(value.url))})));
export const sourceDefinitions=Object.freeze(sourceSeedCatalog.filter(value=>value.origin==='original-seed').map(({id,name,url,kind})=>Object.freeze({id,name,url,kind})));
