# Performance run: validation

> Validation of the suite, not a benchmark: `pnpm perf --engine js --label validation --quick --iterations 2` (2 builds per VU, short ramps), one run, and a Rust build may have been compiling on the same machine. Treat the numbers as an order of magnitude. Raw output is not kept.

- Date: 2026-11-11T11:07:52.621Z
- Commit: 4ba67d1e (dirty tree)
- Diff engine (CIRCI_DIFF_ENGINE): js
- Machine: Apple M4 Pro, 12 cores, 24 GB; Node v26.13.0; k6 v2.3.0 (commit/devel, go1.27.1, darwin/arm64)
- Stack: built server bundle, `serve` and `worker` as two processes, Postgres in Docker, local-disk storage
- Parameters: upload levels 1/5/20 concurrent builds x 2 iterations; 10 screenshots per build (6 pixel-diffed, 2 added, the rest unchanged); dashboard up to 50 VUs (5s ramps, 10s hold); benchmark 5 iterations per pair

## Upload pipeline (k6)

| concurrent builds | done / failed | builds/min | screenshots/s | diffed/s | finalize to done med / p95 / max (ms) | create p95 | upload p95 | finalize p95 | status p95 | uploaded MB | errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2 / 0 | 66.2 | 11.04 | 6.62 | 793 / 796 / 796 | 27.9 | 28.2 | 18.3 | 15.5 | 23 | 0.0% |
| 5 | 10 / 0 | 111.0 | 18.50 | 11.10 | 2079 / 2991 / 3108 | 40.5 | 78.9 | 19.3 | 11.4 | 115 | 0.0% |
| 20 | 40 / 0 | 118.0 | 19.66 | 11.80 | 9592 / 10153 / 10402 | 163 | 184 | 162 | 15.5 | 90 | 0.0% |

## Dashboard read API (k6)

| endpoint | median ms | p95 ms | max ms |
| --- | ---: | ---: | ---: |
| projects | 6.2 | 10.5 | 33.5 |
| workspace_builds | 6.3 | 11.5 | 14.2 |
| build_detail | 11.9 | 17.7 | 30.0 |
| inbox | 5.5 | 8.8 | 21.4 |
| reviews | 5.4 | 8.8 | 14.3 |
| triage | 10.3 | 16.3 | 24.3 |
| baselines | 7.3 | 11.2 | 19.0 |
| insights_30d | 14.9 | 20.9 | 31.9 |
| insights_90d | 15.6 | 22.9 | 32.0 |

1908 requests, 67 req/s overall, errors 0.00%. All p95 thresholds held.

## Diff microbenchmark (`diffImages`)

| change | size | pair | median ms | p95 ms | peak RSS MB | changed pixels |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| reencoded | 1440x900 | docs | 9 | 13 | 221 | 0 |
| reencoded | 1440x4000 | landing-full | 32 | 32 | 333 | 0 |
| small | 1440x900 | dashboard | 80 | 85 | 354 | 18615 |
| small | 1440x4000 | article-full | 262 | 269 | 376 | 20984 |
| large | 1440x900 | settings | 187 | 188 | 376 | 907212 |
| large | 1440x4000 | catalog-full | 272 | 276 | 398 | 1893731 |
| size-changed | 1440x4200 | article-full-taller | 273 | 275 | 538 | 288000 |

Engine js. 4 pairs at a time: 12.13 pairs/s. Process max RSS 572 MB.

## CPU and memory

| during | process | CPU avg % | CPU peak % | RSS avg MB | RSS peak MB | samples |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| upload, 1 concurrent | server | 4 | 9 | 140 | 166 | 4 |
| upload, 1 concurrent | worker | 64 | 185 | 369 | 533 | 4 |
| upload, 1 concurrent | postgres | 5 | 9 | 49 | 61 | 2 |
| upload, 5 concurrent | server | 9 | 29 | 192 | 219 | 8 |
| upload, 5 concurrent | worker | 164 | 270 | 597 | 652 | 8 |
| upload, 5 concurrent | postgres | 10 | 20 | 74 | 85 | 4 |
| upload, 20 concurrent | server | 9 | 45 | 232 | 245 | 23 |
| upload, 20 concurrent | worker | 232 | 292 | 628 | 676 | 23 |
| upload, 20 concurrent | postgres | 15 | 41 | 86 | 90 | 11 |
| dashboard reads | server | 26 | 36 | 235 | 278 | 28 |
| dashboard reads | worker | 1 | 1 | 559 | 594 | 28 |
| dashboard reads | postgres | 23 | 32 | 83 | 90 | 15 |
| whole run | server | 14 | 45 | 230 | 279 | 73 |
| whole run | worker | 95 | 292 | 576 | 676 | 73 |
| whole run | postgres | 15 | 41 | 77 | 90 | 38 |

CPU is a percentage of one core (200 = two cores busy), the delta of the process's CPU time over one-second samples; Postgres comes from `docker stats` (the Docker VM's view, a sample every ~2 s).

The server (`serve`) and the worker (`worker`) are separate processes, so each row is exactly one of them; image work (sharp threads) counts under the process that runs it.
