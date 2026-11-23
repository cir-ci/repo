---
'@circi/cli': patch
---

Adds `toolDir(dir, tool)` to `@circi/cli/names`: each tool that writes captures owns `<dir>/<tool>` (`.circi/screenshots/vitest`, `.circi/screenshots/storybook`), so tools sharing a project never upload or clean each other's files. A shard with no screenshots (more shards than tests, or every test skipped) now still reports in, so the parallel build completes instead of waiting for it.
