const recordedTime = value => typeof value === 'string' ? Date.parse(value) : NaN;

/** Reconcile only the latest receipt with a later confirmation of the same provider post. */
export function measuredPublication(receipt, result, platform, metrics) {
  if (!receipt || !result || result.status === 'published') return result;
  const measured = metrics?.social?.posts?.find(post => post.postId === receipt.postId)?.[platform]?.publication;
  if (measured?.status !== 'published' || !result.providerPostId || measured.providerPostId !== result.providerPostId) return result;
  const measuredAt = recordedTime(metrics.social.measuredAt || metrics.measuredAt);
  const dates = [receipt.createdAt,receipt.submittedAt,receipt.publishedAt,result.submittedAt,result.publishedAt].map(recordedTime).filter(Number.isFinite);
  if (!Number.isFinite(measuredAt) || !dates.length || measuredAt < Math.max(...dates)) return result;
  return {...result,status:'published',message:'The publishing service confirmed this publication in the latest measurement.'};
}
