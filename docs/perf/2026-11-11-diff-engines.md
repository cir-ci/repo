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

## Four engines (second round, commit 0ebf06d9)

The same suite, again back to back on fresh stacks, now with `js-workers` (pixelmatch in a pool of
worker threads, 11 on this machine) and with the benchmark honouring the engine (it ran `js` in the
first round whatever was asked, so ignore that round's benchmark table).

| 20 concurrent builds | JS | JS, worker threads | Rust, all cores | Rust, 1 thread |
|---|---:|---:|---:|---:|
| builds/min | 118 | 251 | **261** | 180 |
| finalize → done, median | 9.9 s | 4.4 s | 4.5 s | 6.4 s |
| worker CPU, average | 239% | 514% | 485% | 325% |
| worker RSS, peak | 696 MB | **1835 MB** | 703 MB | 753 MB |
| builds/min per worker core | 49 | 49 | 54 | 55 |

| at 1 and 5 concurrent | JS | JS, worker threads | Rust, all cores | Rust, 1 thread |
|---|---:|---:|---:|---:|
| 1: builds/min | 66 | 80 | 96 | 101 |
| 1: finalize → done, median / p95 | 795 / 800 ms | 533 / 768 ms | 523 / 527 ms | 521 / 522 ms |
| 5: builds/min | 115 | 190 | 225 | 166 |

Diff benchmark (`diffImages`, median ms per pair; 4 pairs at a time):

| pair | JS | JS, worker threads | Rust, all cores | Rust, 1 thread |
|---|---:|---:|---:|---:|
| small change, 1440×900 | 78 | 82 | 75 | 76 |
| small change, 1440×4000 | 250 | 270 | 231 | 241 |
| large change, 1440×900 | 182 | 193 | **67** | 149 |
| large change, 1440×4000 | 273 | 285 | **102** | 221 |
| pairs/s, 4 at a time | 12.1 | 19.7 | **24.4** | 15.5 |
| process max RSS | 560 MB | **1980 MB** | 647 MB | 599 MB |

**Reading it.** Worker threads recover almost all of Rust's throughput under load (251 against 261
builds/min, the same 4.4 s wait) with no native module, but at about 2.6× the worker's memory: each
thread is its own V8 isolate, and the pixel buffers are copied into it. Per CPU, worker threads are
no cheaper than plain JS; Rust is about 10% cheaper. Rust is the clear winner on large changes
(2.7× faster per diff) and on memory, at the cost of a Rust toolchain in the image build and a
binary per architecture. `CIRCI_DIFF_THREADS` caps the pool, and with it the memory.

## Bigger loads (third round, commits cdebc26d and 3b802212)

Each level on its own fresh stack (so it uploads its files), 2 builds per k6 VU, uploads retried as
`@circi/cli` retries them (3 attempts). Every build in every run finished, with no failures.

**50 concurrent builds of 10 screenshots** (500 screenshots in flight):

| | JS | JS, worker threads | Rust |
|---|---:|---:|---:|
| builds/min | 116 | 241 | **252** |
| finalize → done, median | 25.0 s | 11.4 s | **11.1 s** |
| worker CPU, average | 247% | 541% | 512% |
| worker RSS, peak | 747 MB | 2059 MB | **698 MB** |
| upload retries (macOS loopback) | 9 | 11 | 0 |

**Builds of 120 screenshots** (72 pixel-diffed each; the generated ten repeated under new names, so
"uploaded MB" understates real uploads):

| concurrent builds | | JS | JS, worker threads | Rust |
|---|---|---:|---:|---:|
| 1 | finalize → done, median | 6.1 s | 3.7 s | **2.9 s** |
| 5 | builds/min | 10.5 | 22.5 | **22.9** |
| | finalize → done, median | 23.7 s | 11.1 s | **10.6 s** |
| 10 | builds/min | 10.5 | 22.4 | **22.8** |
| | finalize → done, median | 55.1 s | 25.6 s | **25.8 s** |
| | diffed screenshots/s | 12.6 | 26.9 | **27.4** |
| | worker RSS, peak | 1211 MB | 2881 MB | **1220 MB** |

**100 and 120 concurrent** couldn't be measured on this Mac: twice, about a minute in, Docker
Desktop's VM shut down (its port-forwarding proxy first, then the VM's services; no macOS memory
kill), taking the perf Postgres with it. That exposed a real bug, fixed in 3b802212: a dropped
Postgres connection crashed the server and the worker (node-postgres's `error` event had no
listener). Run 100+ on Linux or in CI, where Postgres isn't behind Docker Desktop's forwarding.
