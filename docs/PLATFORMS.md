# Website RSS to LinkedIn Page

The v4 scope is the website and the While You Sleep LinkedIn Page: https://www.linkedin.com/company/whileyousleep-ai/.

Relay: **Website -> RSS -> Zapier -> LinkedIn Page**. Danielius connects Zapier and authorizes the LinkedIn Page; Claude configures the relay. Keep its credentials and tokens only in the service's private UI. The legacy social.yml workflow is disabled and is not called by the publication loop.

RSS URL: **https://xndanius.github.io/while-you-sleep/feed.xml**.

LinkedIn pick feed: **https://xndanius.github.io/while-you-sleep/best.xml**. The approval reported at 15:10:58 Vilnius on 11 October was corrected later: the Zap still read `/feed.xml` when hourly mode started. No hourly website post was published during that mismatch, and Claude reported no hourly LinkedIn post. Danielius then confirmed that the corrected Zap was published and reads `/best.xml`; the current confirmation and both historical reports are in `data/relay`. Hosted hourly gates check the current status before reserving model work. This feed starts empty and never backfills posts published before activation. A deterministic selection at 12:17 and 18:17 Vilnius records the highest checked score of at least 6 from the preceding 12 hours, excluding already picked posts, with at most two picks per day. A window with no eligible idea records its reason and supplies no RSS item.

Best-feed descriptions begin with the score and five criterion values, followed by the promise in the same first paragraph. The buyer hypothesis and first-24-hours paragraphs retain the ordinary feed's text. The full description still fits 1,000 characters and excludes LinkedIn markup characters. Original post IDs, publication times, page URLs and JPEG identities stay the same. Selection scores are frozen in the pick receipt so a later weight change cannot edit an existing relay item.

One RSS item represents one independently checked published post. GUID is the stable post ID with isPermaLink=false. Items are newest first; link and canonical URL use /p/<id>/. The description is plain text of at most 1,000 characters in three paragraphs: the promise, “Who might pay:” with one explicit hypothesis label, and “First 24 hours:” with up to three numbered steps on separate lines. Blank lines survive XML parsing. Complete sentences are retained or dropped; an individually overlong sentence ends at a word boundary with an ellipsis. The relay adds the source-link line, so the RSS description has no trailing source reminder.

RSS titles and descriptions exclude LinkedIn markup characters: parentheses, square and curly brackets, angle brackets, at signs, hash signs, asterisks, underscores, tildes, vertical bars and backslashes. The full website article retains its original checked text. The image is an absolute 1080x1350 JPEG URL in enclosure and media:content; enclosure length is the actual byte size.

The post page contains the complete checked post and source links. Static Open Graph tags provide title, description, image, 1080x1350 dimensions, URL and article type. The meta description, og:description and twitter:description share a one-line summary of at most 300 characters ending at a sentence or word boundary. A summary_large_image card and canonical link use the same public URL.

Danielius via Claude confirmed the first LinkedIn Page post at **11:55 Vilnius on 11 October 2026** and the active Zap in brief v4. The public relay state records that confirmation; no individual LinkedIn post URL was supplied. RSS availability and successful website publication do not establish LinkedIn publication or measured engagement. No LinkedIn metric is fabricated as zero.
