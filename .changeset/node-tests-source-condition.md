---
'@circi/vitest-config': patch
---

Node test projects now load workspace packages from their source, as the browser projects already did. Before, Vite's SSR resolution skipped the `@circi/source` condition, so a Node test imported a workspace package's `dist/` build. When that package's build ran alongside the tests in the gate, it was rewriting `dist/`, and tests failed with "Cannot find module".
