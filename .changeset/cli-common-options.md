---
'@circi/cli': patch
---

For tools built on the CLI (`@circi/vitest`, `@circi/storybook`): adds `CirciOptions.Common` (the options they share), `uploadCaptures` (upload a folder of captures when a run ends: credentials from the options or the environment, a notice and no upload without them, a failed upload reported rather than thrown), `writeCapture`, `mapLimit`, `shardFlag`, `shardFromArgs`, `shardFromEnv` (`CIRCI_SHARD`), `ignoreBrokenPipe`, `debugOn` and `reportError`, and a browser-safe `@circi/cli/names` (screenshot naming, `DEFAULT_DIR`, `STABILIZE_CSS`). The `circi` command is unchanged.
