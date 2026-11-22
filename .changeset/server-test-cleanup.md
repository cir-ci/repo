---
'@circi/server': patch
'@circi/worker': patch
'@circi/services': patch
'@circi/db': patch
'@circi/auth': patch
'@circi/diff': patch
'@circi/cli': patch
'@circi/vitest': patch
'@circi/testing': patch
'@circi/e2e': patch
---

Server-side test cleanup, with nothing to change in how the app or the packages behave: shared helpers for seeded builds and members, the mail fake, sign-in by email code, PNG builders, temp directories, the auth secret and fake timers; duplicated and wrapper-only tests removed (each assertion still has a test that covers it); fixed waits in the live-stream tests replaced by ordered marker events; one database per file in the triage tests; the CLI's slow spawned test kept only where the exit code matters. `@circi/vitest`'s slow plugin test (a real nested Vitest run in Chromium) now runs as its own `pnpm test:vitest` task, part of `pnpm gate`, instead of on the Node tests' critical path.
