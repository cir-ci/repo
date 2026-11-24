---
'@circi/vitest-config': patch
---

The dashboard's browser tests now load the design system (`@circi/ui`) as one pre-built module, not as one module per source file. Each test file opens a fresh page that loads its imports again, so this means about a hundred fewer modules per file. On one worker, the browser page's peak memory fell from 1.4 GB to 1.1 GB, and the run takes about a tenth less time. The CSS modules stay separate, so the token plugin still processes them. A change to `@circi/ui`'s source rebuilds the pre-built module on the next run. A watch session that's already running keeps the module it started with.
