export const DEFAULT_FEED_VIEW=Object.freeze({sort:'newest',min:'any',period:'all'});
const OPTIONS={sort:['newest','best'],min:['any','6','7','8'],period:['24h','7d','all']};
const normalize=value=>Object.fromEntries(Object.keys(OPTIONS).map(key=>[key,OPTIONS[key].includes(value?.[key])?value[key]:DEFAULT_FEED_VIEW[key]]));

export function readFeedView(search=''){
  const params=new URLSearchParams(search);
  return normalize(Object.fromEntries(Object.keys(OPTIONS).map(key=>[key,params.getAll(key).length===1?params.get(key):null])));
}

export function feedViewURL(currentURL,view){
  const url=new URL(currentURL),state=normalize(view);
  for(const key of Object.keys(OPTIONS)){
    if(state[key]===DEFAULT_FEED_VIEW[key])url.searchParams.delete(key);
    else url.searchParams.set(key,state[key]);
  }
  return url.href;
}

export function overallScore(post){
  const value=post?.scoring?.overall;
  return typeof value==='number'&&Number.isFinite(value)&&value>=1&&value<=10?value:null;
}

const publicationTime=post=>typeof post?.publishedAt==='string'&&Number.isFinite(Date.parse(post.publishedAt))?Date.parse(post.publishedAt):null;
const byNewest=(a,b)=>(publicationTime(b)??-Infinity)-(publicationTime(a)??-Infinity)||String(a.id).localeCompare(String(b.id));

export function filterAndSortPosts(posts,view=DEFAULT_FEED_VIEW,now=new Date()){
  const state=normalize(view),instant=new Date(now).getTime();
  if(!Number.isFinite(instant))throw new Error('A valid feed view time is required.');
  const duration=state.period==='24h'?24*60*60*1000:state.period==='7d'?7*24*60*60*1000:null;
  const minimum=state.min==='any'?null:Number(state.min);
  const selected=posts.filter(post=>{
    const score=overallScore(post),publishedAt=publicationTime(post);
    if(minimum!==null&&(score===null||score<minimum))return false;
    return duration===null||publishedAt!==null&&publishedAt>=instant-duration&&publishedAt<=instant;
  });
  // Ranking and thresholds use the shared helper's unrounded mean. Rounding
  // is presentation only; a pending score is never converted into zero.
  return selected.sort((a,b)=>{
    if(state.sort==='best'){
      const left=overallScore(a),right=overallScore(b);
      if(left===null&&right!==null)return 1;
      if(left!==null&&right===null)return -1;
      if(left!==null&&right!==null&&left!==right)return right-left;
    }
    return byNewest(a,b);
  });
}
