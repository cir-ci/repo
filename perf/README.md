# Performance suite (`@circi/perf`)

Repeatable numbers for CirCI: how fast builds are processed, how fast the dashboard answers, and
how long one image comparison takes. It is not a test and is not part of `pnpm gate`. Built for
before/after comparisons (for example the diff engine: `CIRCI_DIFF_ENGINE=js` against `js-workers` against `native`).

Needs Docker (Postgres only), [k6](https://k6.io) on the `PATH`, and Node 26 like the rest of the repo.

## Run it

```sh
pnpm perf --label js --engine js          # the whole suite -> perf/results/<timestamp>-js/
pnpm perf --label native --engine native  # same, after restarting the stack with the other engine
pnpm perf --label js-workers --engine js-workers  # pixelmatch in a worker-thread pool (CIRCI_DIFF_THREADS sets its size)
pnpm perf --quick --label try             # short: 2 builds per level, 5 s ramps, 5 benchmark iterations
pnpm perf:down                            # stop everything and delete the stack's data
```

`pnpm perf` builds the server bundle if there is none (`pnpm build`), generates the fixtures
once, brings the stack up if it is not running (or restarts it when `--engine` differs from the
running one), runs the scenarios and writes the results. The stack stays up afterwards, so a second
run is quick; `pnpm perf:down` removes it.

Options: `--label NAME`, `--engine js|js-workers|native` (default: `$CIRCI_DIFF_ENGINE`, else leave the stack
as it is), `--levels 1,5,20` (concurrent builds), `--iterations 3` (builds per VU per level),
`--dashboard-vus 50`, `--ramp 20` and `--hold 40` (seconds), `--bench-iterations 15`, `--quick`,
`--skip-bench`, `--skip-upload`, `--skip-dashboard`.

Results folder: `summary.md` (the tables), `k6-upload-c<N>.json` / `k6-dashboard.json` (k6
summaries with every metric), `*.log` (k6 output), `bench.json`, `samples.csv` (CPU and memory,
one row per second per process) and `meta.json`. Raw output is gitignored; only a summary kept on
purpose is committed (`perf/results/<date>-validation/summary.md`).

For a fair before/after, start each engine from an empty stack: `pnpm perf:down && pnpm perf --engine js --label js`,
then `pnpm perf:down && pnpm perf --engine native --label native`, on an idle machine. Files are stored by
content hash, so a second run on the same stack finds the fixtures already uploaded and (see
Fixtures) skips thumbnails; the summary's "uploaded MB" column shows how much was really sent.

## The stack under test

`pnpm perf:stack [--engine js|js-workers|native]` (also what `pnpm perf` calls) starts, and `pnpm perf:down` removes:

- **Postgres 18** in Docker, compose project `circi-perf` (`perf/compose.yml`), host port **54349**,
  its own volume, default settings (fsync on).
- **The built server bundle** (`apps/server/dist/main.mjs`, as in the image) as two processes: `serve`
  (HTTP on **:3310**) and `worker`, so the CPU and memory of each can be told apart.
  `CIRCI_DIFF_ENGINE` is passed to both. `NODE_ENV=production`, log level `warn`.
- **Local-disk storage** in `perf/.state/files` (uploads go through the API, as with `STORAGE_DRIVER=fs`
  in a small install). No S3 is involved, so no LocalStack.
- A **seed** (once per stack, `perf/.state/seed.json`): an account (`perf@example.com`), workspace
  `perf`, project `web-app` and its CI token, made with the admin CLI as `dev/src/seed.ts` does; an
  approved baseline build on `main`; four reviewed pull-request builds so the dashboard has data.

Nothing is shared with `pnpm dev` (compose project `circi-dev`, Postgres :54329, server :3000, Vite
:5173, data in `.dev/`): the perf stack uses another compose project, other ports (override with
`PERF_PORT` and `PERF_POSTGRES_PORT`) and `perf/.state`. `perf:down` only ever touches
project `circi-perf` and that folder.

## Scenarios

**Upload pipeline** (`k6/upload.js`, one k6 run per concurrency level). Each virtual user is a CI job
making the calls `@circi/cli` makes (see `packages/cli/src/upload.ts`): `POST /v1/builds`, `PUT`
each file the server asks for (8 at a time), `POST /v1/builds/:id/finalize`, then poll
`GET /v1/builds/:id/status` (every 250 ms, finer than the CLI's backoff, so the wait is measured
rather than rounded) until the build is processed. A build has 10 screenshots against the
baseline: 2 unchanged (identical bytes, no pixel work), 2 re-encoded (same pixels, other bytes),
2 small diffs, 2 large diffs and 2 added (the two of a kind are one viewport and one full page, except the unchanged ones, both viewport). Six of
them are pixel-diffed by the worker.
Metrics: latency of each request kind, **finalize to done** (time from the finalize reply to a
non-pending status), builds per minute, screenshots per second and **diffed** screenshots per second
(over the whole k6 run), uploaded bytes, errors.

**Dashboard reads** (`k6/dashboard.js`): signed-in `GET`s of the projects list, the workspace builds
list, a build, the inbox, reviews, triage, baselines and insights over 30 and 90 days, in the order a
page visit makes them, with VUs ramping to 50. p95 thresholds: 500 ms (1 s and 1.5 s for insights).
It signs in once through the real `/api/auth/sign-in/email` and every VU sends that session
(better-auth rate-limits sign-ins per address, so 50 VUs signing in would measure the limiter).

**Diff microbenchmark** (`bench/diff.ts`, `pnpm perf:bench [--iterations N --out file.json]`): calls
`diffImages` from `@circi/diff` on the fixture pairs, one at a time: ms per pair (median, p95, min,
max), peak RSS, and the numbers the comparison found (`changedPixels`, so two engines can be
checked for agreement), then pairs per second with 4 at a time. It reads `CIRCI_DIFF_ENGINE` and passes it to
`diffImages`, so `CIRCI_DIFF_ENGINE=native pnpm perf:bench` (or `js-workers`) runs another engine.

**CPU and memory** (`src/sampler.ts`): while the scenarios run, the runner samples the server and
the worker (`ps` on macOS, `/proc` on Linux) every second and Postgres with `docker stats`. The
summary gives average and peak per process, for each upload level, for the dashboard run and for the
whole run; `samples.csv` has every sample.

## Fixtures

`pnpm perf:fixtures [--force] [--variants N] [--seed N]` writes `perf/fixtures/` (gitignored, about
300 MB, a few seconds): synthetic pages of 1440x900 and full pages of 1440x4000 made with sharp
(header, sidebar, text-like lines, photo-like noisy blocks), deterministic for a seed. Per changed
screenshot there are N variants (default 24) so concurrent builds upload different bytes. Build number
n uses variant n mod N, and the runner carries the count on from one level to the next, so the first
24 builds of a stack upload all-new files; later ones find the files already stored (the server
deduplicates by hash), which also means their thumbnails already exist. The pixel diffs are
always computed.

## Known problems and approximations

- The built bundle's `admin project create` exits before it prints (Node reports an unsettled
  top-level await; the project row is created, but no token is returned). The seed therefore runs the admin
  commands from source, like `dev/src/seed.ts`. The server and the worker that are measured run from
  the bundle, and CI-token authentication works there.
- CPU figures are per process and relative to one core (200 = two cores). Postgres is the Docker VM's
  view and sampled about every 2 seconds, so short runs have few samples. The one-second samples
  of the peak are averages over that second, not instants.
- The benchmark's memory is the benchmark process's RSS after each iteration plus the process
  high-water mark; a Rust engine's memory counts (it lives in the process), but a sample can miss a
  short peak.
- Builds per minute and screenshots per second divide by the whole k6 run, including its setup and the
  tail of the slowest build, so a level with few builds understates the steady rate.
- The machine is shared with whatever else is running: use an idle one for numbers that are compared.
