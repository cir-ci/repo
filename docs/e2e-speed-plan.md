# Plan: a faster, parallel e2e suite

Status: steps 0 to 5 done (2026-11-06). Measured on the dev machine: 598 to 611 s serial before,
**154 s with 3 workers** (172 and 169 s with shuffled file order), 147 of 147 passing in every run;
peak memory 2.5 GB for three workers; 15 to 17 stack boots instead of 22. Details and the shared or
dedicated decision per file are in `e2e/README.md` (Shared stacks, Timings). Not done: sharing one
stack across workers (needs real concurrent isolation), shuffling tests inside a file (files are
shuffled; tests within a file build on each other). Original plan below. Approved 2026-11-05. Decisions: worker wake-up through Postgres `LISTEN/NOTIFY` (a product
change); 3 workers by default (Docker Desktop memory stays as is); stacks shared per profile with
per-test tenants. The `X-Forwarded-For` trust fix is done (`TRUSTED_PROXIES`; `e2e/compose.yml` trusts Docker's private bridge ranges so per-test client addresses keep working). Step 2 started first
(it doesn't touch the e2e harness); steps 0, 1, 3 and 4 follow once the running verification
run has finished.

## 1. Where the time goes today

Last full serial run (`pnpm test:e2e`, 18 files, 146 tests): **1013 s (17 min)**. The three files
that were failing at the time took 482 s of that, mostly waiting out timeouts (one test sat 180 s);
the other 15 files took about 531 s, roughly 35 s each.

| Cost | Why | Rough share |
| --- | --- | --- |
| **21 stack boots, one after another** | every file starts its own compose project (`useStack` in `beforeAll`), three files start two; each boot is about 15 to 20 s (Postgres, Mailpit, the server's migrations, LocalStack for S3 stacks) plus teardown | 6 to 7 min |
| **Rate-limit sleeps** | sign-in helpers sleep 10.5 s whenever better-auth answers 429 (`e2e/src/admin.ts:119`, `people.ts:184/205`, `browser.ts:91`), and `smoke.e2e.test.ts:69` sleeps 10.5 s up front "to start clean"; the limiter is per client IP and every request comes from the same IP | about 0.5 to 2 min, more when tests sign several people in |
| **Failures cost their whole timeout** | `testTimeout` 180 s, `hookTimeout` 600 s, Playwright waits of 30 to 40 s: a broken test waits minutes before it fails | minutes per failure |
| **Worker latency** | the job worker polls the queue every 1 s (`apps/worker/src/runner.ts`, `pollIntervalMs` default, not configurable); every upload, review and webhook waits for the next poll, several times per build | small per step, adds up across about 150 tests |
| **Negative waits** | "nothing more happens" checks sleep a fixed time (`webhooks.e2e.test.ts:370`, 3 s) | seconds |
| **Serial by design** | `fileParallelism: false`: chosen after five agents running stacks and image builds at once overloaded the Docker VM (load average about 60) | the whole suite |

The Docker VM is the real limit: **12 CPUs, 7.75 GB memory** (Docker Desktop). A stack is
Postgres, Mailpit and the server (plus LocalStack, the heaviest, for S3 stacks).

Already done in the harness: Postgres on tmpfs with `fsync=off`, LocalStack only in the `s3`
profile, first-run setup through the API (only the smoke test uses the UI), image built once per
run in `globalSetup`, random ports and a unique compose project per stack.

## 2. Steps, in order (each one measured before the next)

### Step 0: measure (small)

- Add a timing reporter for the e2e project (Vitest's JSON reporter to `e2e/.artifacts/timings.json`)
  and log each stack's phases: compose up, healthy, setup, teardown.
- Record the baseline per file and per phase in `e2e/README.md`.
- Every later step reports its before and after numbers against this baseline.

### Step 1: remove avoidable waits (small, no risk to coverage)

1. **Rate limits: isolate instead of sleeping.** The fix that made `email-login` 8× faster already
   exists (`freshIp()` in `e2e/src/people.ts`: a unique `X-Forwarded-For` per request or browser
   context). Make every `Session` and browser context use its own client address, then delete the
   four 10.5 s sleeps and the retry loops. Keep one dedicated test that asserts the limiter itself
   (3 requests per 60 s per endpoint and client, and the 5 per 15 minutes per address).
   - **Link to the open security item:** if the server is changed to trust `X-Forwarded-For` only
     from a configured proxy (`docs/remaining-work.md` §0b), set that proxy to the compose network
     in `e2e/compose.yml` so this keeps working.
2. **Fail fast.** `testTimeout` 180 s → 60 s, with explicit longer timeouts only on the few tests
   that need them (named in the file). Playwright default timeout 40 s → 10 s. `hookTimeout` 600 s →
   120 s once step 3 makes boots predictable. A broken test then costs seconds, not minutes.
3. **Barriers instead of fixed sleeps.** For "nothing more happens", trigger a later event that
   *would* be processed and wait for it to finish (job row `done`, receiver got it), then assert
   that nothing else arrived. This replaces the 3 s wait in the webhooks test and any future ones.
4. **Backoff without waiting.** Tests already pull `run_at` forward with SQL; turn that into one
   helper, `stack.jobs.runNow(queue, filter)`, and use it wherever a test waits for a retry.
5. **Lint guard.** Ban bare `setTimeout` sleeps and `waitForTimeout` in `e2e/test/` through an
   oxlint `no-restricted-syntax` rule (allowed in `e2e/src/fakes/`, where a delay is the behaviour
   under test), so waits don't creep back.

### Step 2: wake the worker instead of polling (small product change, also faster in production)

- When a job is queued, `NOTIFY circi_jobs`; the worker `LISTEN`s and claims at once. The 1 s poll
  stays as a fallback for missed notifications.
- Unit test in `apps/worker/test/runner.test.ts` (a queued job is picked up well under the poll
  interval). This removes up to a second from every step of every build, in tests and for users.
- If you'd rather not change the product for this, the alternative is a `WORKER_POLL_MS` setting
  that only `e2e/compose.yml` lowers (to about 100 ms).

### Step 3: share stacks between tests (the biggest win, medium)

Most tests don't need a stack of their own: CirCI is multi-tenant, and a test that creates its own
organization, project and people can't see another test's. So:

- **Profiles.** Group stacks by configuration: `default` (fs), `s3`, `sites` (`STATIC_SITES_HOST`),
  `oidc` (instance-wide `AUTH_OIDC_*`), `strict-webhooks` (`WEBHOOK_ALLOW_PRIVATE_ADDRESSES=false`),
  `github` (fake GitHub env). `useStack({ profile: 's3' })` asks for a shared stack of that profile.
- **A pool per Vitest worker.** The first file that needs a profile boots it; later files in the
  same worker reuse it; the pool tears everything down when the worker exits (and on Ctrl-C, as
  today). Expected: from 21 boots to about 6 to 8.
- **Per-test tenants.** A helper `ctx.tenant()` creates a fresh organization, owner and project
  through the API, so tests never share data. Host fakes (GitHub, IdP, webhook receiver) get
  per-test namespaces or one instance per test, the way the receiver already works.
- **Dedicated stacks stay** for tests that change instance-wide state: first-run setup,
  `stack.reconfigure` (storage migration, switching to S3), stopping LocalStack, instance sign-in
  methods, the limiter test, retention with back-dated rows if it sweeps the whole instance.
  `useStack({ dedicated: true })` keeps today's behaviour for them.
- **Risk:** hidden coupling between tests (instance settings, email domains, rate limits, GC
  sweeping another test's files). Mitigation: per-test tenants, dedicated stacks for anything
  instance-wide, and step 5's check.

### Step 4: run in parallel (small once step 3 is done)

- `fileParallelism: true`, `maxWorkers` 3 by default (`E2E_WORKERS` to change). With pooling,
  three workers mean at most about three to six stacks alive at once. That fits 7.75 GB if
  LocalStack stays limited to the `s3` profile. I'll measure peak memory with `docker stats` in
  step 0 and set the default from it.
- The image is built once in `globalSetup` before any worker starts (already true); workers never
  build. If product code changed, the run rebuilds once, not per agent.
- Vitest schedules the longest files first from its cached durations; split the longest files
  (`email-login`, `sites`, `webhooks`, `storage-cli`) into two or three files each so the workers
  finish together.
- Recommended, your call: raise Docker Desktop's memory to 10 to 12 GB, which allows 4 to 5 workers.
- CI: the same suite shards across machines with `vitest --shard=i/n`; document it in
  `docs/ci-examples.md` and `e2e/README.md`.

### Step 5: keep it fast and honest

- Run the suite twice in random file order (`--sequence.shuffle`) and in parallel; any test that
  passes alone but fails shared is coupled: fix it or mark it dedicated.
- Print the timing summary at the end of every run and the five slowest tests.
- The `sso.e2e.test.ts` tests that depend on each other's provider state get their own setup
  (found earlier: one fails when run alone).

## 3. What to expect

These are estimates; step 0 replaces them with measurements.

| After | Wall time (estimate) |
| --- | --- |
| Today | 17 min serial (about 9 min when nothing fails) |
| Step 1 (waits, fail fast) | about 7 to 8 min when green; failures cost seconds |
| Step 2 (worker wake-up) | about 6 to 7 min |
| Step 3 (shared stacks) | about 3 to 4 min serial |
| Step 4 (3 workers) | **about 1.5 to 2.5 min** |

## 4. Questions

1. Worker wake-up: change the product (`LISTEN/NOTIFY`, also faster for users), or only a
   test-only poll setting?
2. Raise Docker Desktop's memory to 10 to 12 GB on this machine (more workers)?
3. Are you OK with tests sharing a stack per profile, with isolation by tenant? Coupling bugs then
   show up as flaky tests until step 5 catches them.
4. (Done: it did.) Should this also fix the `X-Forwarded-For` trust issue now, since step 1 touches the same code
   path?
