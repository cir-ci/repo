---
'@circi/api': patch
'@circi/auth': patch
'@circi/cli': patch
'@circi/config': patch
'@circi/core': patch
'@circi/cypress': patch
'@circi/db': patch
'@circi/dev': patch
'@circi/diff': patch
'@circi/e2e': patch
'@circi/integrations': patch
'@circi/perf': patch
'@circi/server': patch
'@circi/services': patch
'@circi/sites': patch
'@circi/storage': patch
'@circi/storybook': patch
'@circi/testing': patch
'@circi/tsdown-config': patch
'@circi/typescript-config': patch
'@circi/ui': patch
'@circi/vitest': patch
'@circi/vitest-config': patch
'@circi/web': patch
'@circi/worker': patch
---

Each package now typechecks, tests and builds on its own, with its configs from three new config packages: `@circi/typescript-config` (one tsconfig per kind of package), `@circi/vitest-config` (one Vitest config per kind) and `@circi/tsdown-config` (one build config per built package). Turborepo caches every package's typecheck and tests separately, so a change reruns only the packages it touches and the ones that depend on them, and a release's version bumps no longer rerun the whole gate. Nothing in what the packages ship changes: the built output is byte for byte the same.
