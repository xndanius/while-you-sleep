# Website RSS to LinkedIn Page

The v3 scope is the website and the While You Sleep LinkedIn Page: https://www.linkedin.com/company/whileyousleep-ai/.

Relay: **Website -> RSS -> Zapier -> LinkedIn Page**. Danielius connects Zapier and authorizes the LinkedIn Page; Claude configures the relay. Keep its credentials and tokens only in the service's private UI. The legacy social.yml workflow is disabled and is not called by the publication loop.

RSS URL: **https://xndanius.github.io/while-you-sleep/feed.xml**.

One RSS item represents one independently checked published post. GUID is the stable post ID with isPermaLink=false. Items are newest first; link and canonical URL use /p/<id>/. The description is plain text under 600 characters containing the promise, a who-pays hypothesis, first-24-hours steps and “Sources on the page”. The image is an absolute 1080x1350 JPEG URL in enclosure and media:content; enclosure length is the actual byte size.

The post page contains the complete checked post and source links. Static Open Graph tags provide title, description, image, 1080x1350 dimensions, URL and article type. A summary_large_image card and canonical link use the same public URL.

Until an actual LinkedIn Page post is confirmed, the public relay state remains **waiting for first LinkedIn post**. RSS availability and successful website publication do not establish LinkedIn publication or measured engagement. No LinkedIn metric is fabricated as zero.
