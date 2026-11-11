import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { closeDiffPool, diffImages, resolveDiffEngine } from '@circi/diff'

import { FIXTURES_DIR, isEngine } from '../src/config.ts'
import { type FixtureFile, readManifest } from '../src/fixtures.ts'

/**
 * Microbenchmark of `diffImages` (@circi/diff) on the fixture pairs: ms per pair, median and p95,
 * and memory. `CIRCI_DIFF_ENGINE=js|js-workers|native` is read here and passed to `diffImages`, so the
 * same command compares the engines:
 *
 *   CIRCI_DIFF_ENGINE=js node perf/bench/diff.ts --out js.json
 *   CIRCI_DIFF_ENGINE=native node perf/bench/diff.ts --out native.json
 *   CIRCI_DIFF_ENGINE=js-workers node perf/bench/diff.ts --out js-workers.json
 *
 * Options: --iterations N (default 15), --warmup N (default 2), --concurrency N (default 4), --out FILE.
 */

export interface PairResult {
  name: string
  size: string
  kind: string
  iterations: number
  medianMs: number
  p95Ms: number
  minMs: number
  maxMs: number
  /** Highest resident set size sampled after any iteration of this pair (MB). */
  peakRssMb: number
  /** What the comparison found: the numbers the engines must agree on. */
  changedPixels: number
  changed: boolean
  sizeChanged: boolean
  diffPngBytes: number
}

export interface BenchResult {
  engine: string
  node: string
  platform: string
  iterations: number
  pairs: PairResult[]
  throughput: { concurrency: number; pairs: number; seconds: number; pairsPerSecond: number }
  /** The process's high-water mark of resident memory over the whole run (MB). */
  maxRssMb: number
}

const args = process.argv.slice(2)
const option = (flag: string, fallback: string): string => {
  const at = args.indexOf(flag)
  return at >= 0 && args[at + 1] !== undefined ? String(args[at + 1]) : fallback
}

const percentile = (sorted: number[], p: number): number => {
  const at = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, at)] ?? 0
}

const mb = (bytes: number) => bytes / 1_048_576

async function load(file: FixtureFile): Promise<Buffer> {
  return readFile(join(FIXTURES_DIR, file.file))
}

export async function runBench(options: {
  iterations: number
  warmup: number
  concurrency: number
  log?: (line: string) => void
}): Promise<BenchResult> {
  const log = options.log ?? (() => undefined)
  const requested = process.env.CIRCI_DIFF_ENGINE
  if (requested && !isEngine(requested)) {
    throw new Error(`CIRCI_DIFF_ENGINE must be js, js-workers or native, got "${requested}"`)
  }
  // The worker resolves the engine the same way at startup (a native addon or pool script that is
  // missing falls back to js), so the numbers below are for what the server would run.
  const engine = resolveDiffEngine(requested && isEngine(requested) ? requested : 'js', log)
  const manifest = await readManifest()
  const cases: {
    name: string
    size: string
    kind: string
    base: FixtureFile
    head: FixtureFile
  }[] = []
  for (const shot of manifest.shots) {
    const head = shot.variants[0]
    if (!shot.baseline || !head || shot.kind === 'unchanged' || shot.kind === 'added') continue
    cases.push({
      name: shot.name,
      size: `${shot.width}x${shot.height}`,
      kind: shot.kind,
      base: shot.baseline,
      head,
    })
  }
  for (const extra of manifest.extras) {
    cases.push({
      name: extra.name,
      size: `${extra.width}x${extra.height}`,
      kind: 'size-changed',
      base: extra.base,
      head: extra.head,
    })
  }

  const loaded = await Promise.all(
    cases.map(async (c) =>
      Object.assign({}, c, { basePng: await load(c.base), headPng: await load(c.head) }),
    ),
  )
  const pairs: PairResult[] = []
  for (const c of loaded) {
    for (let i = 0; i < options.warmup; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- sequential on purpose: one pair at a time
      await diffImages(c.basePng, c.headPng, { engine })
    }
    const times: number[] = []
    let peakRss = 0
    let last: Awaited<ReturnType<typeof diffImages>> | undefined
    for (let i = 0; i < options.iterations; i += 1) {
      const started = performance.now()
      // oxlint-disable-next-line no-await-in-loop -- sequential on purpose
      last = await diffImages(c.basePng, c.headPng, { engine })
      times.push(performance.now() - started)
      peakRss = Math.max(peakRss, mb(process.memoryUsage().rss))
    }
    if (!last) throw new Error('No iterations')
    const sorted = times.toSorted((a, b) => a - b)
    pairs.push({
      name: c.name,
      size: c.size,
      kind: c.kind,
      iterations: times.length,
      medianMs: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      minMs: sorted[0] ?? 0,
      maxMs: sorted.at(-1) ?? 0,
      peakRssMb: peakRss,
      changedPixels: last.changedPixels,
      changed: last.changed,
      sizeChanged: last.sizeChanged,
      diffPngBytes: last.diffPng?.length ?? 0,
    })
    log(`${c.kind} ${c.size} ${c.name}: median ${percentile(sorted, 50).toFixed(0)} ms`)
  }

  // The worker diffs several pairs of a build at once (a pool); how many per second that gives.
  const queue = loaded.flatMap((c) => Array.from({ length: 2 }, () => c))
  let next = 0
  const started = performance.now()
  await Promise.all(
    Array.from({ length: options.concurrency }, async () => {
      while (next < queue.length) {
        const c = queue[next]
        next += 1
        if (c) {
          // oxlint-disable-next-line no-await-in-loop -- each lane takes one pair at a time
          await diffImages(c.basePng, c.headPng, { engine })
        }
      }
    }),
  )
  const seconds = (performance.now() - started) / 1000
  return {
    engine: requested
      ? `${requested}${engine === requested ? '' : ` (ran ${engine})`}`
      : 'js (default)',
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    iterations: options.iterations,
    pairs,
    throughput: {
      concurrency: options.concurrency,
      pairs: queue.length,
      seconds,
      pairsPerSecond: queue.length / seconds,
    },
    // Node reports kilobytes on every platform.
    maxRssMb: process.resourceUsage().maxRSS / 1024,
  }
}

export function benchTable(result: BenchResult): string {
  const rows = result.pairs.map(
    (p) =>
      `| ${p.kind} | ${p.size} | ${p.name} | ${p.medianMs.toFixed(0)} | ${p.p95Ms.toFixed(0)} | ${p.peakRssMb.toFixed(0)} | ${p.changedPixels} |`,
  )
  return [
    '| change | size | pair | median ms | p95 ms | peak RSS MB | changed pixels |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: |',
    ...rows,
  ].join('\n')
}

if (import.meta.main) {
  const result = await runBench({
    iterations: Number(option('--iterations', '15')),
    warmup: Number(option('--warmup', '2')),
    concurrency: Number(option('--concurrency', '4')),
    log: console.log,
  })
  console.log(`\nengine: ${result.engine}, ${result.node}, ${result.platform}\n`)
  console.log(benchTable(result))
  console.log(
    `\n${result.throughput.concurrency} at a time: ${result.throughput.pairsPerSecond.toFixed(2)} pairs/s; process max RSS ${result.maxRssMb.toFixed(0)} MB`,
  )
  const out = option('--out', '')
  if (out) await writeFile(out, `${JSON.stringify(result, null, 2)}\n`)
  await closeDiffPool()
}
