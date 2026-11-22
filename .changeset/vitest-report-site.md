---
'@circi/vitest': minor
---

New `site` option on `circi()`: `site: true` also hosts Vitest's HTML report as a site named `vitest-report` (kind `vitest-report`), so reviewers can open the run's results next to the screenshots. The plugin adds Vitest's `html` reporter when `@vitest/ui` is installed, waits for it to finish writing, and uploads the report after the screenshots, from the first shard only. `site: { name, dir }` renames the site or hosts a folder of your own. Off by default.
