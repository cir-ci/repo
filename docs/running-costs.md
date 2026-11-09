# What makes CirCI cheaper to run

Notes from 2026-11-09, for a small-budget deployment (one small VM or container, Postgres, S3-compatible
storage). Facts are from the code; items marked **proposal** are not built, and **check** means measure first.

## Where the money goes

1. **Storage and egress.** Every screenshot, diff and thumbnail is an object. This grows with builds × screenshots
   and is usually the biggest bill. Egress (viewers loading images) comes second.
2. **CPU for image work.** `processBuild` compares every screenshot with its baseline using `sharp`
   (`packages/diff`), plus thumbnails. It runs in the worker, one build at a time per lane. This is the only
   CPU-heavy work; a request is cheap.
3. **Postgres.** Small rows, a few joins; the hot tables are `builds`, `files`, `jobs`, `snapshot_reviews`. Fits in
   the smallest managed instance for years unless history is kept forever.
4. **Idle polling.** The worker polls the job queue every 1 s per lane (`runner.ts`, `pollIntervalMs`) and runs a
   review sweep every 5 minutes. At idle that is a handful of tiny queries per second.

## What already keeps it cheap

- **Content-addressed uploads.** Files are stored by SHA-256 and verified; an unchanged screenshot is uploaded and
  stored once (the CLI plans uploads and skips what the server has). Most builds change few screenshots, so storage
  grows with *changes*, not with builds.
- **Retention per team** (default 30 days, workspace default copied to new teams). Files are collected after a grace
  period when nothing references them.
- **WebP thumbnails** (at most 480×720) for lists, so list pages don't pull full images.
- **One bundle, one process option.** The server bundle inlines the worker, so a single container is enough.
- **History caps:** webhook delivery history keeps 50 per webhook; notifications and sweeps are small.

## Levers, biggest first

1. **Use cheap object storage with free egress** (Cloudflare R2, Backblaze B2 behind Cloudflare, or MinIO on the
   same disk). The S3 driver works with any S3-compatible endpoint. Cost drops most here.
2. **Shorten retention** where history isn't needed (7–14 days for PR branches). **Proposal:** a shorter retention
   for non-default-branch builds than for the default branch (baselines must be kept).
3. **Serve screenshots from a CDN with long cache lifetimes.** Objects are content-addressed, so they can be
   `immutable`. Check what headers the image routes send today (sites and some routes send `no-store`/`private`);
   **proposal:** short-lived signed redirects to the bucket/CDN so the app server never streams images.
4. **Limit diff concurrency to the cores you have** and keep the worker in the same process on a 1–2 vCPU box; run a
   second worker only when queue depth (Instance › Health shows it) stays above zero.
5. **Cap screenshot size and count per build** (limits exist in `@circi/core` limits); lower them for small plans.
   **Check:** the largest PNGs dominate both diff CPU and storage; consider storing/serving WebP or optimised PNG.
6. **Skip work that can't change anything:** identical SHA to the baseline is already skipped by hash; **proposal:**
   skip the pixel diff when the baseline and the new file have equal hashes for *every* screenshot of a build (the
   build is `no_changes` without opening images).
7. **Idle polling:** **proposal:** wake workers with Postgres `LISTEN/NOTIFY` and drop the poll to 15–30 s as a
   safety net, so a serverless/auto-pausing Postgres can actually sleep.
8. **Postgres size:** the default managed minimum is enough; **proposal:** purge `webhook_deliveries`, read
   notifications and superseded `snapshot_reviews` rows older than N days in the retention job.
9. **Run on scale-to-zero when quiet:** the server is stateless apart from Postgres and storage; with LISTEN/NOTIFY
   and the sweep moved to a cron-style trigger, it can sleep outside working hours.

## Capacity, roughly (to verify with a load test)

A single 1 vCPU / 1 GB container serving the dashboard handles hundreds of concurrent viewers (reads are small JSON
plus cached images). Uploads and diffs are the limit: a 50-screenshot build takes seconds of CPU, so about one build
every few seconds per core. Measure with the e2e stack before promising numbers.
