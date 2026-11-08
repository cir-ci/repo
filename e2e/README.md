# End-to-end tests (`@circi/e2e`)

These tests run against the **real Docker stack**: Postgres, the `circi:e2e` image built from
`deploy/Dockerfile` (server + worker + dashboard, command `all`), Mailpit for mail and, when a
test asks for S3, LocalStack. The test process drives it from the outside the way users do: the
real CLI (`packages/cli/dist/main.mjs`) uploads, Playwright's Chromium clicks, `/api/auth` signs in.
Fakes for what lives outside the stack (GitHub, an OIDC provider, a webhook receiver) run on the
host.

They are **not** part of `pnpm test` (which never starts Docker).

## Running

Requirements: a running Docker daemon with Compose v2, Chromium for Playwright
(`pnpm exec playwright install chromium`), and the repo installed. No ports are fixed, no
network is needed after the images are pulled once (`postgres:18-alpine`,
`localstack/localstack:4.9`, `axllent/mailpit:v1.27`).

```sh
pnpm test:e2e                                   # everything
pnpm test:e2e e2e/test/review.e2e.test.ts       # one file
pnpm test:e2e -t "rejecting"                    # by test name
E2E_SKIP_BUILD=1 pnpm test:e2e                  # reuse the existing circi:e2e image
E2E_KEEP=1 pnpm test:e2e e2e/test/smoke.e2e.test.ts   # leave the stack up (see Debugging)
E2E_HEADED=1 pnpm test:e2e ...                  # watch the browser
E2E_WORKERS=1 pnpm test:e2e                     # one file at a time (default 3 in parallel)
pnpm test:e2e --sequence.shuffle.files          # random file order (add --sequence.seed=N to repeat one)
pnpm test:e2e --shard=1/3                       # a third of the files, for CI (docs/ci-examples.md)
```

Without Docker the run fails within seconds with a message saying so. The image is rebuilt on
every run (`docker build`, which builds only the server bundle and the web app, so the layer cache makes an unchanged tree take seconds; the first
build on a machine takes several minutes). `circi:e2e` is a shared tag: change code, rerun, and
the new image is what every parallel run of the same checkout sees next.

Parallel runs are safe: every stack gets its own compose project (`circi-e2e-<run>-<n>-<rand>`),
host ports that Docker assigns itself (published as `127.0.0.1::<port>` and read back with `docker compose port`, so there is no window between picking a free port and binding it) and its own volumes. CirCI's port must be known before CirCI starts (`PUBLIC_URL`), so a small `edge` container, a TCP forwarder started first, owns it. Inside one run test files run in parallel on
`E2E_WORKERS` Vitest workers (default 3; about 2.4 GB at the measured peak, see Timings). The image
is built once in `global-setup.ts` before any worker starts. The run always removes its stacks
(`docker compose down -v`), also on failure and Ctrl-C (`global-setup.ts`, which finds them by
compose project-name prefix). Do not use ports 3000 or 5432 for anything here: they are the dev stack's.

### Shared stacks

Booting a stack is the biggest cost (7 s, 12 s with LocalStack), so most files share one:

- `useStack({ profile: 'default' | 's3' | 'github', setup: true })` asks for the stack of that
  profile (`src/pool.ts`). The first file of a Vitest worker that needs a profile boots it (with
  the first-run admin), later files of that worker reuse it. A worker's files run one after
  another, so a shared stack is never in use by two files; different workers have different stacks.
  A worker keeps at most `E2E_POOL_MAX` (default 2) stacks and removes the least recently used one
  when a third profile is asked for; the rest go when the run ends. The `vitest.config.ts` setting
  `isolate: false` is what keeps a worker's pool alive between files.
- Every file gets **its own tenant** on a shared stack: `ctx.setup` is a fresh workspace with
  its own owner (an instance admin, like the first-run account) and a signed-in session, so files
  never see each other's data. `await ctx.tenant({ team: 'Web' })` makes more of them (a test
  that needs two workspaces, or its own provider or domain); `ctx.admin` is the first-run admin.
  Anything global that a test creates needs a name of its own: a workspace email domain, a
  GitHub user id, a repository (`owner/name`), a client address.
- The `github` profile owns a fake GitHub (`ctx.github`, under `/api/v3`, as GitHub Enterprise
  serves it); it is `reset()` at the start of every file. The github.com form (the API address
  with no path) is covered by `github-root-url.e2e.test.ts`, which runs its own fake on a dedicated
  stack.
- `useStack({ dedicated: true, ... })` (also the default without `profile`) starts a stack for the
  file and removes it afterwards. Use it for anything instance-wide: first-run setup, `reconfigure`,
  stopping a service, instance sign-in settings (`AUTH_OIDC_*`), retention and garbage-collection
  sweeps and the instance's disk usage, extra server environment, and `STATIC_SITES_HOST`.
  When unsure, choose dedicated.

Which file uses what (this list is the decision record; keep it current):

| File | Stack | Why |
| --- | --- | --- |
| review, flaky, dogfood, email-login, invitations, webhooks, sso (workspace part) | `default`, shared | everything is scoped to the file's workspace; email-login's limiter test and the domain test use their own addresses and domain |
| github-root-url | dedicated | the shared fake serves `/api/v3` (Enterprise form); this file's own fake answers at the root, as `https://api.github.com` does, which needs `GITHUB_API_URL` set differently |
| github-app, github-approve, merge-gate, host-fakes | `github`, shared | one fake GitHub per worker, reset per file; each file uses repositories and GitHub user ids of its own |
| s3, storage-s3-doctor, sites (the S3 describe) | `s3`, shared | LocalStack for the worker; the files use content of their own (the bucket is shared) |
| smoke | dedicated | first-run setup in the browser |
| sso (`AUTH_OIDC_*` describe) | dedicated | instance-wide sign-in method |
| retention | dedicated | back-dated rows and `storage gc` sweep the whole instance |
| storage-cli | dedicated | `reconfigure` from disk to S3, resumable migration of the whole instance |
| storage-s3 | dedicated | stops LocalStack, compares the bucket with every file row of the instance |
| sites (local describe) | dedicated | `STATIC_SITES_HOST`, and a test that runs `storage gc` |
| sites-security | dedicated | `STATIC_SITES_MAX_MB=1`, probes the container's file system |
| webhooks-ssrf | dedicated | `WEBHOOK_ALLOW_PRIVATE_ADDRESSES=false` |


## Layout

```
e2e/
  compose.yml          postgres, localstack (profile s3), mailpit, edge (the published port), circi
  src/
    stack.ts           startStack(): compose project, Docker-assigned ports, override env, up --wait, exec/cli/sql/logs, stop
    pool.ts            the shared stacks of a Vitest worker (profiles, acquire, eviction, exit cleanup)
    vitest.ts          useStack(), useBrowser(): the hooks most test files need
    admin.ts           Session (cookie jar), signIn, completeSetup, createTenant, createTeam, invite, CLI users
    upload.ts          uploadBuild()/uploadOrThrow(): the real CLI against the stack
    git-repo.ts        Repo: scratch git repo, real commits and branches, origin = itself
    images.ts          screenshot(): deterministic PNGs with sharp
    browser.ts         Chromium (host.docker.internal mapped), sessions, sign-in through the UI
    mail.ts            Mailbox: Mailpit client, waitFor(), extractCode(), extractLinks()
    s3.ts              S3Bucket: list/get/put/delete in the LocalStack bucket (AWS SDK)
    fakes/             fake-github.ts, fake-idp.ts, webhook-receiver.ts
    global-setup.ts    Docker preflight, image build, teardown
  test/
    fakes/*.test.ts    tests of the fakes themselves: plain Node, no Docker (run by `pnpm test`)
    *.e2e.test.ts      the end-to-end tests (run only by `pnpm test:e2e`)
```

## Writing a test

```ts
import { describe, expect, it } from 'vitest'
import { createTeam, Repo, uploadOrThrow, useBrowser, useStack } from '../src/index.ts'

describe('my feature', () => {
  const ctx = useStack({ profile: 'default', setup: true }) // shared stack + this file's own workspace, owner and session
  const browser = useBrowser() // fresh page per test; trace + screenshot only on failure
  it('does the thing', async () => {
    const { stack, setup } = ctx
    const team = await createTeam(setup.session, setup.workspace.slug, 'Web')
    const repo = await Repo.create()
    await repo.writeShots({ home: {} })
    await repo.commit('first')
    const up = await uploadOrThrow({ stack, token: team.token, repo, wait: true })
    const page = await browser.as(setup.session) // a page already signed in
    await page.goto(`${stack.url}/${setup.workspace.slug}/${team.slug}/builds/${up.build.number}`)
    expect(up.exitCode).toBe(0)
  })
})
```

Rules of thumb:

- Assert behaviour (the API state, the page, the bucket, the mail), not just status codes. Poll
  asynchronous worker steps with `expect.poll(...)` or the fakes' `waitFor(...)`; do not sleep.
- Options of a dedicated stack: `useStack({ dedicated: true, storage: 's3' })` (LocalStack, bucket
  created for you, `stack.s3`), `{ sitesHost: 'sites.localhost' }` (static sites; the dashboard is
  then `http://127.0.0.1:<port>`
  because the sites domain must be unrelated to the dashboard host), `{ env: { ... } }` (any
  server variable, e.g. `GC_GRACE_HOURS`, `WORKSPACE_CREATION`, `AUTH_OIDC_*`).
  Defaults the stack sets: `SMTP_*` to Mailpit, `WEBHOOK_ALLOW_PRIVATE_ADDRESSES=true`,
  `GC_GRACE_HOURS=0`, `UPLOAD_TIMEOUT_MINUTES=0`.
- `stack.cli('workspace', 'create', ...)` runs `circi admin ...` in the container; `stack.sql(...)` runs
  SQL (e.g. to back-date a build for retention); `stack.exec(service, [...])` runs anything;
  `stack.logs('circi')` reads logs; `stack.restart('circi')`.
- Email: `await stack.mail.waitFor({ to })`, then `extractCode(msg)` / `extractLinks(msg)`.
- Sign-in and code requests are rate-limited per client address. Every `Session` and every browser
  context has its own address (`freshIp()` and `clientAddressHeaders()` in `src/client-address.ts`, the
  `X-Forwarded-For` header), so tests never wait the limiter out; the one test that sends several
  requests from one address is the limiter test in `email-login.e2e.test.ts`. Never sleep for a
  limit: give the request its own address.
- No fixed sleeps in `test/` (oxlint bans `setTimeout` and `waitForTimeout` there; the fakes in
  `src/fakes` may delay). To prove "nothing more happens", send a later event that would be
  processed and wait for it, then assert. `stack.jobs.runNow(queue, { payloadField: value })` makes
  pending jobs due now, so a retry with backoff need not be waited out.
- Fail fast: `testTimeout` 60 s, `hookTimeout` 120 s, Playwright's default timeout 10 s
  (`PLAYWRIGHT_TIMEOUT_MS`). A test that really waits says so: `it(name, { timeout: ... }, fn)`.
- The tests of one file run in order and share the file's tenant (and its stack), so use unique
  names (`newAccount()`) and don't count what is instance-wide (`select count(*) from sso_provider`:
  scope it to the file's workspace). Files are independent of each other; tests within a file may
  build on earlier ones, so shuffle files (`--sequence.shuffle.files`), not tests.

## Timings

Every run writes `e2e/.artifacts/timings.json` (per file, per test, per stack) and prints a summary
at the end: total, each file with its stacks' boot and teardown, the five slowest tests. Each stack
prints one line when it is removed: `[e2e] <project>: compose up 7.4s, healthy 0.0s, setup 0.7s,
teardown 0.8s`. Peak memory of a run: `docker stats --no-stream` sampled every few seconds, summed
over the `circi-e2e-*` containers.

Baseline, measured 2026-11-06 on the dev machine (Docker Desktop VM: 12 CPUs, 7.75 GB), serial, before
the Step 1 changes (rate-limit sleeps, `testTimeout` 180 s), worker already woken by LISTEN/NOTIFY,
`E2E_SKIP_BUILD=1`: **668 s total**, 147 tests, 1 failure (a test that raced the now faster worker).

| Phase | Measured |
| --- | --- |
| Stack boot (`compose up --wait`) | 7.4 s default stack, about 12 s with LocalStack; `healthy` wait about 0 s |
| First-run setup through the API | 0.7 s |
| Teardown (`down -v`) | 0.7 s default, 2 to 4 s with LocalStack |
| Stacks per run | 22 (about 3.3 min of boot and teardown in all) |
| Peak memory | about 620 MB for all containers of one stack at a time (default stack about 450 MB; with LocalStack about 620 MB) |

Per file (seconds, baseline): webhooks 90, storage-s3 65, merge-gate 59, github-approve 58,
flaky 54, sites 43, invitations 42, email-login 40, storage-cli 40, sso 32, retention 23, smoke 23,
s3 18, github-app 17, review 17, webhooks-ssrf 15, host-fakes 14, sites-security 13.

Worker wake-up (`LISTEN/NOTIFY`) on the real stack: a queued job is picked up in a median of 73 ms
(69 to 77 ms), against a median of 768 ms when the job is inserted without a NOTIFY, which is what
the old 1 s poll saw. `circi upload --wait` polls the build status at 500 ms, backing off by half
each time to 2 s (`pollDelay` in `packages/cli/src/upload.ts`).

After steps 1 to 5 (shared stacks, 3 workers), same machine:

| Run | Wall time | Stack boots | Peak memory |
| --- | --- | --- | --- |
| Baseline, serial, one stack per file | 598 to 611 s (668 s on 2026-11-06) | 22 | about 620 MB |
| Shared stacks, 1 worker (`E2E_WORKERS=1`) | 436 s | 15 (pool cap 2 evicts) | 1.07 GB |
| Shared stacks, 3 workers, plain | 154.5 s | 16 | 2.49 GB |
| Shared stacks, 3 workers, shuffled files (2 seeds) | 172 s and 169 s | 15 and 16 | 2.37 and 2.40 GB |

All runs: 19 files, 147 of 147 tests passed. The Docker VM has 7.75 GB.

Peak memory is the sum over the `circi-e2e-*` containers, sampled by the reporter with
`docker stats` every 4 s. Stack boots are per worker: a profile is booted once by each worker that
needs it, so the count depends on how files land on workers (15 to 17 in the runs above). The
critical path is now the longest files (storage-s3, webhooks), whose time is mostly real waiting
(LocalStack stopped and restarted, the webhook backoff schedule).

## The fakes (all on the host, reachable from the container as `host.docker.internal`)

The circi container has `extra_hosts: host.docker.internal:host-gateway`; Chromium is launched
with `--host-resolver-rules="MAP host.docker.internal 127.0.0.1"`, and the host-run CLI preloads
`dns-preload.ts`. So one URL works for the server, the browser and the CLI.

- **`startFakeGithub()`**: the GitHub REST API `packages/providers/src/github.ts` calls:
  installation tokens (the app JWT is verified against a key pair generated per run), check runs
  (create/update, stored with their actions and every body), PR comments (list/create/edit,
  reactions), collaborator permission (`setPermission`), commits and statuses. Everything is
  recorded in `requests`; `failNext('POST /repos/acme/web/check-runs', 502)` makes calls fail;
  `sendWebhook(stack.url, 'check_run', payload)` sends a GitHub-signed webhook to CirCI. Start the
  stack with `env: gh.env()`.
- **`startFakeIdp(clientId)`**: an OIDC provider whose `/authorize` signs `idp.identity` in
  immediately. Use `idp.issuer` as `AUTH_OIDC_ISSUER` (or the workspace SSO provider's issuer).
- **`startWebhookReceiver()`**: records deliveries, verifies `CirCI-Signature` with
  `@circi/core` (`setSecret(secret)` with the secret CirCI shows when the webhook is created),
  `failWith(500, 2)` fails the next two, `waitFor(...)`.

Close fakes in `afterAll`. Only the edge is fake: say so in a test that depends on a fake.

## Debugging

- A failing test saves a screenshot and Playwright trace to `e2e/.artifacts/browser/<test>/`
  (`pnpm exec playwright show-trace <trace.zip>`) and its stack's logs to
  `e2e/.artifacts/<project>/<service>.log`. The folder is gitignored.
- `E2E_KEEP=1`: stacks are not removed. Each prints its compose project name and URL when its file ends, e.g.
  `left circi-e2e-ab12cd-1-9f3e running at http://localhost:54213`. Open the URL, read mail at the
  printed Mailpit URL, `docker compose -p <project> logs -f circi`, and clean up with
  `docker compose -p <project> down -v`.
- `docker ps --filter name=circi-e2e` lists live stacks; leftovers from a killed run can be
  removed with `docker compose -p <project> down -v`.

## Paste into the main docs (README "Development" / CLAUDE.md "Tests")

> **End-to-end tests** (`e2e/`, `pnpm test:e2e`): run against the real Docker stack (Postgres,
> the image from `deploy/Dockerfile`, Mailpit, LocalStack for S3) driven by the real CLI,
> Playwright and `/api/auth`; not part of `pnpm test`. Needs Docker and Chromium; see
> `e2e/README.md`. Fakes (GitHub, OIDC, webhook receiver) live in `e2e/src/fakes` and have their own
> Node tests. A bug found only by the real stack gets a regression test in its owning package.
