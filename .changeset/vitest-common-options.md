---
'@circi/vitest': patch
---

Internal: the reporter's upload step, screenshot naming and shard parsing now come from `@circi/cli`, shared with `@circi/storybook`. Options, names, defaults, exit codes and exports (including `Shard`, `shardFromArgs`, `DEFAULT_DIR`, `STABILIZE_CSS`) are unchanged.
