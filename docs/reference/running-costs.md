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
- **Retention per project** (default 30 days, workspace default copied to new projects). Files are collected after a grace
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
   `immutable`. Image responses are already `private, max-age=31536000, immutable` (browser cache only; `private` stops a
   shared CDN caching them, so switch to `public` or signed redirects for CDN use). **Proposal:** short-lived signed redirects to the bucket/CDN so the app server never streams images.
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

## Capacity, roughly (from reading the code; nothing is benchmarked)

On about 2 vCPU / 4 GB with one small Postgres: dozens to a couple of hundred people browsing the dashboard at once,
and a few CI builds per minute.

- **Browsing is cheap.** Pages are small JSON queries. Screenshots are served with
  `private, max-age=31536000, immutable`, so a second view costs nothing. The Inbox list is capped at 200 items.
- **Image processing is the limit.** The worker runs 2 jobs at a time by default (`concurrency ?? 2`,
  `apps/worker/src/runner.ts`); each decodes and compares every screenshot with `sharp`. Throughput is builds per
  minute, not users; a burst of CI runs queues up.
- **Every screenshot request streams through Node.** `dashboard/builds/files.ts` checks access in the database, then streams
  the object from storage (no redirect to a signed URL). A review page opens many images, so first loads from many
  users cost bandwidth and connections. This also uses the database pool (default 10 connections).
- **Unpaginated lists:** Reviews and Insights load whole result sets (Insights aggregates in JavaScript), which is
  fine for modest history and slow for large history.

Cheapest ways to raise the ceiling: run the web server and the worker as separate processes; put a CDN or
reverse-proxy cache in front of `/files/:sha256` (or use signed storage URLs); raise the pool size and add a pooler;
set worker concurrency to the core count and cap screenshot size at upload. The number that would settle this is one
profile of a typical build (screenshots, size, CPU seconds) on real infrastructure.
