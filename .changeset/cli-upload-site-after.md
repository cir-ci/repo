---
'@circi/cli': patch
---

Adds `uploadSiteAfter`, which tools built on the CLI use to host a built site (Storybook, Vitest's HTML report) after their screenshots: only when the screenshots were uploaded, with an address and a token, from the first shard, and a failed upload is logged and fails the run only with `strict`.
