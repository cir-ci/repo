---
'@circi/vitest': minor
---

Screenshots are now written to `.circi/screenshots/vitest/<test file>/<name>.png` instead of `.circi/screenshots/<test file>/<name>.png`, so other tools can use their own folders next to it. The `dir` option is still the parent (default `.circi/screenshots`), and screenshot names in CirCI don't change. If you read the files yourself (a CI artifact path, say), point them at the `vitest` subfolder. A shard that has no screenshots still reports in, so a parallel build is no longer left waiting for it.
