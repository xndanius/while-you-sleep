// Presentation consumes the registry owner's already validated receipt joins.
// It cannot turn a missing historical measurement into a zero or a success.
export function normalizedSourceView(view) {
  if(view?.schema!==1||!Array.isArray(view.sources))throw new Error('Source presentation requires a validated registry view.');
  const count=value=>Number.isInteger(value)&&value>=0?value:null;
  const score=value=>typeof value==='number'&&Number.isFinite(value)&&value>=1&&value<=10?value:null;
  const rows=view.sources.map(source=>{
    const yieldRecord=source.yield||{},health=source.health||source.latestObservation||null;
    const ranking=source.rank&&typeof source.rank==='object'?source.rank:source.ranking||{};
    const robots=source.validation?.robots;
    const robotsState=source.validation?.robotsState||(!Array.isArray(robots)?robots?.state||robots?.status:null)||
      (source.validation?.robotsAllowed===true&&Array.isArray(robots)&&robots.length>0&&robots.every(record=>record.allowed===true)?'allowed':null);
    return {id:source.id,name:source.name,url:source.url,kind:source.kind,status:source.status,addedAt:source.addedAt,howAdded:source.howAdded,reason:source.statusReason,lastFetchAt:health?.fetchedAt||source.lastScannedAt||null,health:health?{status:health.status,message:health.message}:null,
      validation:{robotsState,checkedAt:source.lastValidatedAt||source.validation?.checkedAt||null},
      stats:{fetchAttempts:count(yieldRecord.scans),successfulFetches:count(yieldRecord.successfulScans),itemsFetched:count(yieldRecord.itemsFetched),distinctItems:count(yieldRecord.distinctItems),candidates:count(yieldRecord.candidates),checkedCandidates:count(yieldRecord.checkedCandidates),passedChecks:count(yieldRecord.passedChecks),scoreSamples:count(yieldRecord.scoreSamples),averageScore:score(yieldRecord.averageScore),published:count(yieldRecord.published),linkedInPicks:count(yieldRecord.linkedInPicks)},
      ranking:{position:Number.isInteger(ranking.position)&&ranking.position>0?ranking.position:null,value:typeof ranking.value==='number'&&Number.isFinite(ranking.value)?ranking.value:null,basis:ranking.basis||null,exploration:ranking.exploration===true},historicalAttribution:source.historicalAttribution||'unknown'};
  });
  const changes=(view.recentChanges||[]).map(change=>({...change,at:change.at||change.createdAt,from:change.from??change.fromStatus,to:change.to??change.toStatus}));
  return {enabled:typeof view.coverageStartedAt==='string',schema:1,generatedAt:view.updatedAt,lastEvolutionAt:view.lastEvolutionAt||null,lastDiscoveryAt:view.lastDiscoveryAt||null,discoveryBudget:view.discoveryBudget||null,recentDiscoveries:view.recentDiscoveries||[],coverage:{startedAt:view.coverageStartedAt||null,reason:view.coverageStartedAt?'Measured yield starts at registry activation. Earlier source attribution remains unavailable.':'Source yield accounting has not started.',unknownAttribution:view.unknownAttribution||null},policy:view.policy||{},rows,changes,exclusions:view.exclusions||[]};
}
