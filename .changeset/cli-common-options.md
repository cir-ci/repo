---
'@circi/cli': patch
---

Adds `CirciOptions.Common`, the options `@circi/vitest` and `@circi/storybook` share (`apiUrl`, `token`, `name`, `dir`, `clean`, `root`, `wait`, `strict`, `shard`), and exports `debugOn` and `reportError` for tools built on the CLI. The `circi` command is unchanged.
