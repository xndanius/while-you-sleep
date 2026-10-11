import {hash,canonicalURL} from './storage.mjs';
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
 {name:'Hacker News · Launch HN',kind:'hn-launches',url:'https://news.ycombinator.com/launches',reason:'Public launch discussion list; distinct from the currently script-only YC Launches page.'},
 {name:'YC · AI company directory',kind:'yc-directory',url:'https://www.ycombinator.com/companies/industry/artificial-intelligence',reason:'Public maker directory, not a launch feed; company evidence must be independently checked.'},
 {name:'Simon Willison · public AI notes',kind:'rss',url:'https://simonwillison.net/atom/everything/',reason:'Public Atom feed with attributable AI/product experiments.'},
 {name:'Latent Space · public newsletter',kind:'rss',url:'https://www.latent.space/feed',reason:'Public newsletter RSS; only complete bounded public entries are eligible.'},
 {name:'Ben’s Bites · public newsletter',kind:'rss',url:'https://www.bensbites.com/feed',reason:'Public newsletter RSS; paid or login-only evidence is never fetched.'},
].map(value=>({...value,origin:'public-feed-proposal'}));
export const sourceSeedCatalog=Object.freeze([...originals,...requested,...alternatives].map(value=>Object.freeze({...value,url:canonicalURL(value.url),id:hash(canonicalURL(value.url))})));
export const sourceDefinitions=Object.freeze(sourceSeedCatalog.filter(value=>value.origin==='original-seed').map(({id,name,url,kind})=>Object.freeze({id,name,url,kind})));
