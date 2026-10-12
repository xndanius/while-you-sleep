Danielius can mark a published idea good or bad by editing data/feedback/marks.json in GitHub while signed in as xndanius. Use a verified signed commit, such as the GitHub web editor. No API key or password belongs in this file.

Each entry has exactly postId, value, markedAt and reason. value is good or bad; markedAt is an ISO UTC timestamp; reason is one line of at most 280 characters. Use an existing published post ID. The most recent mark for an idea replaces earlier marks for that idea.

Example shape, with the marks array initially empty:

```json
{"schema":1,"marks":[]}
```

A trusted recording job verifies the GitHub author, signed commit, exact blob and current file hash. Until that verification succeeds, marks have no effect. The verifier stores public commit provenance separately; content models cannot write feedback or that provenance.

A verified mark adds weight 20 to the segment posterior, compared with weight 1 for an independently verified demand and novelty outcome. Source credit is updated only when a trusted learning receipt identifies the source. A mark on an older idea can guide its transparently classified buyer segment, without fabricating historical demand evidence. Selection remains subject to the segment diversity limits. Marks guide future searches; they do not lower publication standards or rewrite an idea.
