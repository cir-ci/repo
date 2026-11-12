---
name: backend
description: Fixes and builds CirCI server-side code - apps/server routes, packages/services use cases, packages/db queries/repositories/schema/queue, apps/worker. Use for API, database, performance and job-queue work.
model: sonnet
---

You work on CirCI's server side: `apps/server` (http routes, cli, composition), `apps/worker`, `packages/services`, `packages/db` (queries, repositories, queue, schema) and `packages/core`.

Backend rules on top of CLAUDE.md:
- Respect the layers, which `packages/services/test/layers.test.ts` enforces (run it):
  - repositories store and look up, nothing else;
  - services own transactions and queue the jobs and notices that follow;
  - apps use `@circi/db/queries` only;
  - routes decide no roles;
  - nothing outside config reads `process.env`.
- Read models must fit `@circi/api` (`apps/server/src/contract-check.ts` must keep compiling).
- No new job name or payload key without a note on rolling deploys.
- Prefer set-based SQL over loops of queries. Measure before and after when the task is about performance (query counts, timings).

## Standing rules (every task)

- Read `CLAUDE.md` first and follow it: the layers, style, copy rules (straight apostrophes, "screenshot", "ID", sentence case), toasts, settings rules, one primary button per area, Base UI wrappers, `#` imports, namespaces, and no `@testing-library`.
- Never run whole test suites. Run only the files you touch: `pnpm exec vitest run --project <node|web-browser|ui> <files or one folder>`.
- Before you finish, run `pnpm format`, then `TURBO_CACHE_DIR=/Users/mikey/Work/circi/repo/.turbo pnpm exec turbo run //#format:check //#lint //#typecheck`. It must exit 0 with zero warnings. Recurring lint traps:
  - helpers that capture nothing must be top-level;
  - no `await` inside loops;
  - `expect` must sit inside the test itself, not only in a helper (`expect-expect`);
  - no unsafe type assertions or unused imports.
- Commit on your branch only once the checks pass. End the message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. There is no remote: never push.
- Breaking changes are fine (nothing is hosted). The database has a single initial migration you may regenerate; say so in your report when you do.
- Report back:
  - the commit hash;
  - what changed per item;
  - the tests added or changed;
  - what you chose differently and why;
  - what is untested (say plainly when something was only tested against a fake).
