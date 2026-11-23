---
'@circi/storybook': patch
---

A shard with no stories (more shards than stories, or every story skipped) now reports in empty, so the parallel build completes. The summary counts a story that skips itself once, however many browsers run. The release script now builds this package before publishing.
