# Diff engines under load: JS against Rust (2026-11-11)

Three runs of `pnpm perf`, back to back, each on a freshly torn-down stack (`pnpm perf:down`):
`--engine js`, `--engine native`, and `--engine native` with `RAYON_NUM_THREADS=1`. Commit
22d857f4. Apple M4 Pro, 12 cores, 24 GB; Node 26.13; built server bundle; `serve` and `worker` as
separate processes; Postgres in Docker; local-disk storage. Each build has 10 screenshots (6
pixel-diffed, 2 added, 2 unchanged), at 1440×900 and full-page 1440×4000; 3 builds per k6 VU per
level. The dev environment was running, idle, on the same machine.

## Upload pipeline

| concurrent builds | | JS | Rust, all cores | Rust, 1 thread |
|---|---|---:|---:|---:|
| 1 | builds/min | 67 | 99 | 101 |
| | finalize → done, median | 796 ms | 524 ms | 521 ms |
| 5 | builds/min | 116 | 244 | 165 |
| | finalize → done, median | 2.32 s | 1.05 s | 1.54 s |
| 20 | builds/min | 122 | **269** | 180 |
| | finalize → done, median | 9.67 s | **4.25 s** | 6.43 s |
| | worker CPU, average | 244% | 510% | 319% |
| | worker RSS, peak | 874 MB | 740 MB | 704 MB |
| | builds/min per worker core | 50 | 53 | 56 |

No build failed in any run, and no request errored.

## What it shows

- **The JS engine's limit is the worker's one JavaScript thread, not the CPU.** The worker plateaus
  at about 2.4 cores whatever the load. sharp (decode, encode) runs on libuv's thread pool, but
  pixelmatch runs on the event loop, so the comparisons of concurrent builds queue behind each
  other.
- **The native engine runs off that thread** (an async napi call on the libuv pool). Even on one
  thread per comparison it lifts throughput 48% (122 → 180 builds/min at 20 concurrent). With rayon
  across all cores it is 2.2× (→ 269) and halves the wait (9.7 s → 4.3 s).
- **Per CPU it's only a little cheaper**: 50 → 53–56 builds per minute per worker core. The win is
  using the machine's cores, not doing less work. On a server already short of cores the gain is
  smaller.
- **Memory**: the worker's peak is 15–20% lower (874 → 704–740 MB), as the comparison's buffers stay
  out of the JS heap.
- **The dashboard read API is unchanged** (p95 9–26 ms for every endpoint at 50 VUs): it doesn't
  touch the diff.
- **The `diffImages` microbenchmark barely moves** (e.g. 263 → 248 ms for a small change at
  1440×4000): run four at a time in one process, it is dominated by sharp's PNG decode and encode.

## Open questions

- A JS-only alternative would also take the comparison off the event loop: pixelmatch in worker
  threads. It would recover much of the parallelism without a native module; worth measuring
  before shipping the Rust engine as the default.
- PNG encoding of the diff image is now the largest cost per diff; a lower compression level or
  encoding only when something changed may save more CPU than the comparison does.
