// A transparent annotation of one audited historical repeat. This is derived
// presentation metadata, never a replacement for the original checked posts.
// The complete evidence is in docs/DUPLICATE_AUDIT_2026-10-14.md.
export const HISTORICAL_OVERLAPS=Object.freeze([
  Object.freeze({
    postId:'98b4f6281cc3de4ecdfa95f6',
    contentSha256:'2a0a33b3585bd9f622c7223a8ed6eddd7069666d828ea302207d91ef3ed818c3',
    publishedAt:'2026-10-11T20:31:22.470Z',
    earlierPostId:'e20bcacf021524725d3fc275',
    earlierContentSha256:'bd7b87ce08f86736bcdaeabbab4686ac3b0e889c60b987612bc4a77f7293008e',
    earlierPublishedAt:'2026-10-11T17:15:34.229Z',
    earlierTitle:'A human checked support inbox loop',
    label:'Another tool for the same support-inbox loop.',
    reason:'Both propose classifying support messages, drafting replies from approved material, and recording a human-reviewed outcome for an online shop or support team.',
    preventionCommit:'57275e6ec9979007de2cc3e6c0ced8bf682962cb',
    auditedOn:'2026-10-14'
  })
]);

export function historicalOverlapFor(post){
  return HISTORICAL_OVERLAPS.find(entry=>entry.postId===post?.id&&entry.contentSha256===post?.contentSha256&&entry.publishedAt===post?.publishedAt)||null;
}
