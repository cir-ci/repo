# @circi/typescript-config

The TypeScript settings of every package in the repository, one file per kind of package. A package's
`tsconfig.json` extends the one for its kind and adds only what is its own (`include`, `exclude`, and
`paths`, which resolve against the file that sets them):

| File | For |
| --- | --- |
| `tsconfig.base.json` | What every kind shares: strict, Node ESM, `@circi/source` (workspace packages resolve to their TypeScript), no emit. |
| `tsconfig.node.json` | Node packages and apps (the server, the worker, the CLI, the libraries, `e2e`, `dev`, `perf`). |
| `tsconfig.ui.json` | `@circi/ui`: the DOM and React's JSX, no Node types. |
| `tsconfig.web.json` | The dashboard (`apps/web`): Vite's bundler resolution. |
| `tsconfig.cypress.json` | `@circi/cypress`'s browser half: the DOM and Cypress's types. |

Each package's `typecheck` script runs `tsc` on its own `tsconfig.json`, cached per package by Turborepo.
