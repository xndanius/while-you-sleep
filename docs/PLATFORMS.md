# Website RSS to LinkedIn Page

The v3 scope is the website and the While You Sleep LinkedIn Page: https://www.linkedin.com/company/whileyousleep-ai/.

Relay: **Website -> RSS -> Zapier -> LinkedIn Page**. Danielius connects Zapier and authorizes the LinkedIn Page; Claude configures the relay. Keep its credentials and tokens only in the service's private UI. The legacy social.yml workflow is disabled and is not called by the publication loop.

RSS URL: **https://xndanius.github.io/while-you-sleep/feed.xml**.

One RSS item represents one independently checked published post. GUID is the stable post ID with isPermaLink=false. Items are newest first; link and canonical URL use /p/<id>/. The description is plain text of at most 1,000 characters in three paragraphs: the promise, “Who might pay:” with one explicit hypothesis label, and “First 24 hours:” with up to three numbered steps on separate lines. Blank lines survive XML parsing. Complete sentences are retained or dropped; an individually overlong sentence ends at a word boundary with an ellipsis. The relay adds the source-link line, so the RSS description has no trailing source reminder.

RSS titles and descriptions exclude LinkedIn markup characters: parentheses, square and curly brackets, angle brackets, at signs, hash signs, asterisks, underscores, tildes, vertical bars and backslashes. The full website article retains its original checked text. The image is an absolute 1080x1350 JPEG URL in enclosure and media:content; enclosure length is the actual byte size.

The post page contains the complete checked post and source links. Static Open Graph tags provide title, description, image, 1080x1350 dimensions, URL and article type. The meta description, og:description and twitter:description share a one-line summary of at most 300 characters ending at a sentence or word boundary. A summary_large_image card and canonical link use the same public URL.

Until an actual LinkedIn Page post is confirmed, the public relay state remains **waiting for first LinkedIn post**. RSS availability and successful website publication do not establish LinkedIn publication or measured engagement. No LinkedIn metric is fabricated as zero.
