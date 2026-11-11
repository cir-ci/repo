import { execFile, spawn } from 'node:child_process'
import { cpSync, existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { cpus, totalmem } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { benchTable, type BenchResult } from '../bench/diff.ts'
import {
  type DiffEngine,
  COMPOSE_PROJECT,
  PERF_DIR,
  REPO_ROOT,
  RESULTS_DIR,
  SEED_FILE,
  RUN_MANIFEST_FILE,
  STATE_DIR,
  isEngine,
} from './config.ts'
import { ensureFixtures, withShots } from './fixtures.ts'
import { Sampler, type Usage } from './sampler.ts'
import { down, isUp, readStack, up } from './stack.ts'

const exec = promisify(execFile)

/**
 * `pnpm perf [--label L] [--engine js|js-workers|native] [--quick]`: the whole suite against the perf stack,
 * into perf/results/<timestamp>-<label>/. See perf/README.md for the options.
 */

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const option = (name: string, fallback: string): string => {
  const at = args.indexOf(name)
  return at >= 0 && args[at + 1] !== undefined ? String(args[at + 1]) : fallback
}

const quick = flag('--quick')
const levels = option('--levels', '1,5,20').split(',').map(Number)
const iterations = Number(option('--iterations', quick ? '2' : '3'))
const dashboardVus = Number(option('--dashboard-vus', '50'))
const ramp = Number(option('--ramp', quick ? '5' : '20'))
const hold = Number(option('--hold', quick ? '10' : '40'))
const benchIterations = Number(option('--bench-iterations', quick ? '5' : '15'))
// Screenshots per build (the 10 generated, repeated under new names beyond that).
const shots = Number(option('--shots', '10'))
if (!(Number.isInteger(shots) && shots >= 1)) throw new Error('--shots must be at least 1')
const requestedEngine = option('--engine', process.env.CIRCI_DIFF_ENGINE ?? '')
const label = option('--label', requestedEngine || 'run')

const log = (line: string) => console.log(`[perf] ${line}`)

// ---------------------------------------------------------------------------------------------
// k6
// ---------------------------------------------------------------------------------------------

interface K6Summary {
  metrics: Record<string, { type: string; values: Record<string, number>; thresholds?: unknown }>
  state: { testRunDurationMs: number }
}

function runK6(script: string, env: Record<string, string>, out: string, logFile: string) {
  return new Promise<{ exitCode: number; summary: K6Summary }>((resolve, reject) => {
    const child = spawn(
      'k6',
      [
        'run',
        '--quiet',
        '--no-color',
        ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
        '-e',
        `SUMMARY_OUT=${out}`,
        join(PERF_DIR, 'k6', script),
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const chunks: Buffer[] = []
    child.stdout.on('data', (c: Buffer) => chunks.push(c))
    child.stderr.on('data', (c: Buffer) => chunks.push(c))
    child.on('error', reject)
    child.on('close', (code) => {
      const text = Buffer.concat(chunks).toString()
      const finish = async () => {
        await writeFile(logFile, text)
        // 99: a threshold failed. The run still has numbers; the summary says which.
        if (code !== 0 && code !== 99) {
          throw new Error(`k6 ${script} exited ${code}:\n${text.slice(-2000)}`)
        }
        try {
          // k6's own JSON, written by handleSummary.
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion
          const summary = JSON.parse(await readFile(out, 'utf8')) as K6Summary
          return { exitCode: code, summary }
        } catch (err) {
          throw new Error(`k6 ${script} left no summary:\n${text.slice(-2000)}`, { cause: err })
        }
      }
      finish().then(resolve, reject)
    })
  })
}

const value = (s: K6Summary, metric: string, stat: string): number =>
  s.metrics[metric]?.values[stat] ?? 0
const ms = (n: number) => (n >= 100 ? n.toFixed(0) : n.toFixed(1))

function thresholdsFailed(s: K6Summary): string[] {
  const failed: string[] = []
  for (const [name, m] of Object.entries(s.metrics)) {
    if (typeof m.thresholds !== 'object' || m.thresholds === null) continue
    for (const [expr, result] of Object.entries(m.thresholds)) {
      if (typeof result === 'object' && result !== null && Reflect.get(result, 'ok') === false) {
        failed.push(`${name}: ${expr}`)
      }
    }
  }
  return failed
}

// ---------------------------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------------------------

interface UploadRun {
  vus: number
  summary: K6Summary
  startedAt: number
  endedAt: number
  usage: Usage[]
  exitCode: number
}

function uploadTable(runs: UploadRun[]): string {
  const head =
    '| concurrent builds | done / failed | builds/min | screenshots/s | diffed/s | finalize to done med / p95 / max (ms) | create p95 | upload p95 | finalize p95 | status p95 | uploaded MB | upload retries | errors |'
  const rows = runs.map((r) => {
    const s = r.summary
    const seconds = s.state.testRunDurationMs / 1000
    const done = value(s, 'builds_done', 'count')
    return `| ${r.vus} | ${done} / ${value(s, 'builds_failed', 'count')} | ${((done / seconds) * 60).toFixed(1)} | ${(value(s, 'screenshots_total', 'count') / seconds).toFixed(2)} | ${(value(s, 'screenshots_diffed', 'count') / seconds).toFixed(2)} | ${ms(value(s, 'finalize_to_done', 'med'))} / ${ms(value(s, 'finalize_to_done', 'p(95)'))} / ${ms(value(s, 'finalize_to_done', 'max'))} | ${ms(value(s, 'req_create_build', 'p(95)'))} | ${ms(value(s, 'req_upload_file', 'p(95)'))} | ${ms(value(s, 'req_finalize', 'p(95)'))} | ${ms(value(s, 'req_status_poll', 'p(95)'))} | ${(value(s, 'uploaded_bytes', 'count') / 1_048_576).toFixed(0)} | ${value(s, 'upload_retries', 'count')} | ${(value(s, 'errors', 'rate') * 100).toFixed(1)}% |`
  })
  return [
    head,
    `| ${head
      .split('|')
      .slice(1, -1)
      .map(() => '---')
      .join(' | ')} |`,
    ...rows,
  ].join('\n')
}

function usageTable(rows: { scope: string; usage: Usage[] }[]): string {
  const out = [
    '| during | process | CPU avg % | CPU peak % | RSS avg MB | RSS peak MB | samples |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
  ]
  for (const r of rows) {
    for (const u of r.usage) {
      out.push(
        `| ${r.scope} | ${u.target} | ${u.avgCpu.toFixed(0)} | ${u.peakCpu.toFixed(0)} | ${u.avgRssMb.toFixed(0)} | ${u.peakRssMb.toFixed(0)} | ${u.samples} |`,
      )
    }
  }
  return out.join('\n')
}

const DASHBOARD_ENDPOINTS = [
  'projects',
  'workspace_builds',
  'build_detail',
  'inbox',
  'reviews',
  'triage',
  'baselines',
  'insights_30d',
  'insights_90d',
]

function dashboardTable(s: K6Summary): string {
  const rows = DASHBOARD_ENDPOINTS.map(
    (e) =>
      `| ${e} | ${ms(value(s, `req_${e}`, 'med'))} | ${ms(value(s, `req_${e}`, 'p(95)'))} | ${ms(value(s, `req_${e}`, 'max'))} |`,
  )
  return [
    '| endpoint | median ms | p95 ms | max ms |',
    '| --- | ---: | ---: | ---: |',
    ...rows,
  ].join('\n')
}

async function git(...a: string[]): Promise<string> {
  try {
    return (await exec('git', a, { cwd: REPO_ROOT })).stdout.trim()
  } catch {
    return 'unknown'
  }
}

// ---------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------

if (requestedEngine && !isEngine(requestedEngine))
  throw new Error('--engine must be js, js-workers or native')
const engine: DiffEngine | undefined = isEngine(requestedEngine) ? requestedEngine : undefined

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '')
const outDir = join(RESULTS_DIR, `${stamp}-${label}`)
await mkdir(outDir, { recursive: true })
// The server's and the worker's logs go with the results, whatever happens to the run: the next
// `perf:down` deletes perf/.state, and a failed run is the one whose logs matter most.
process.on('exit', () => {
  const logs = join(STATE_DIR, 'logs')
  if (existsSync(logs)) cpSync(logs, join(outDir, 'logs'), { recursive: true })
})

const manifest = withShots(await ensureFixtures(log), shots)
let current = readStack()
// The baseline build was seeded with the stack's screenshots: another count needs a fresh stack.
if (current && current.shots !== shots) {
  log(`The stack has ${current.shots} screenshots per build, this run ${shots}: starting it afresh`)
  await down()
  current = undefined
}
if (!isUp() || (engine && current?.engine !== engine)) {
  log(`Bringing the stack up${engine ? ` with CIRCI_DIFF_ENGINE=${engine}` : ''}`)
  await up(engine ?? current?.engine ?? undefined, shots)
}
const stack = readStack()
if (!stack) throw new Error('The stack is not running')
const effectiveEngine = stack.engine ?? 'default (js)'
log(`Results in ${outDir}; diff engine: ${effectiveEngine}`)

const sampler = new Sampler([
  { name: 'server', pid: stack.serverPid },
  { name: 'worker', pid: stack.workerPid },
  { name: 'postgres', container: `${COMPOSE_PROJECT}-postgres-1` },
])
sampler.start()

// 1. Diff microbenchmark, in its own process so it reads CIRCI_DIFF_ENGINE like the worker does.
let bench: BenchResult | undefined
if (!flag('--skip-bench')) {
  log(`Diff benchmark (${benchIterations} iterations per pair)`)
  const benchOut = join(outDir, 'bench.json')
  await exec(
    process.execPath,
    [
      join(PERF_DIR, 'bench', 'diff.ts'),
      '--iterations',
      String(benchIterations),
      '--out',
      benchOut,
    ],
    {
      env: { ...process.env, ...(stack.engine ? { CIRCI_DIFF_ENGINE: stack.engine } : {}) },
      maxBuffer: 16 * 1024 * 1024,
    },
  )
  // Written by bench/diff.ts.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  bench = JSON.parse(await readFile(benchOut, 'utf8')) as BenchResult
}

// 2. Upload pipeline at rising concurrency, one k6 run per level.
const uploads: UploadRun[] = []
let offset = 0
if (!flag('--skip-upload')) {
  for (const vus of levels) {
    log(`Upload pipeline: ${vus} concurrent build(s) x ${iterations}`)
    const startedAt = Date.now()
    // eslint-disable-next-line no-await-in-loop -- the levels run one after another
    const { exitCode, summary } = await runK6(
      'upload.js',
      {
        PERF_STATE: SEED_FILE,
        PERF_FIXTURES: join(PERF_DIR, 'fixtures'),
        PERF_MANIFEST: RUN_MANIFEST_FILE,
        VUS: String(vus),
        ITERATIONS: String(iterations),
        OFFSET: String(offset),
      },
      join(outDir, `k6-upload-c${vus}.json`),
      join(outDir, `k6-upload-c${vus}.log`),
    )
    offset += vus * iterations
    uploads.push({ vus, summary, startedAt, endedAt: Date.now(), usage: [], exitCode })
  }
}

// 3. Dashboard reads.
let dashboard:
  | { summary: K6Summary; startedAt: number; endedAt: number; exitCode: number }
  | undefined
if (!flag('--skip-dashboard')) {
  log(`Dashboard reads: up to ${dashboardVus} VUs`)
  const startedAt = Date.now()
  const { exitCode, summary } = await runK6(
    'dashboard.js',
    {
      PERF_STATE: SEED_FILE,
      PEAK_VUS: String(dashboardVus),
      RAMP_S: String(ramp),
      HOLD_S: String(hold),
    },
    join(outDir, 'k6-dashboard.json'),
    join(outDir, 'k6-dashboard.log'),
  )
  dashboard = { summary, startedAt, endedAt: Date.now(), exitCode }
}

await sampler.stop(join(outDir, 'samples.csv'))
for (const u of uploads) u.usage = sampler.usage(u.startedAt, u.endedAt)

const k6Version = (await exec('k6', ['version']).catch(() => ({ stdout: 'unknown' }))).stdout.trim()
const sections: string[] = []
sections.push(`# Performance run: ${label}`)
sections.push(
  [
    `- Date: ${new Date().toISOString()}`,
    `- Commit: ${await git('rev-parse', '--short', 'HEAD')}${(await git('status', '--porcelain')) ? ' (dirty tree)' : ''}`,
    `- Diff engine (CIRCI_DIFF_ENGINE): ${effectiveEngine}`,
    `- Machine: ${cpus()[0]?.model ?? 'unknown'}, ${cpus().length} cores, ${(totalmem() / 2 ** 30).toFixed(0)} GB; Node ${process.version}; ${k6Version}`,
    `- Stack: built server bundle, \`serve\` and \`worker\` as two processes, Postgres in Docker, local-disk storage`,
    `- Parameters: upload levels ${levels.join('/')} concurrent builds x ${iterations} iterations; ${manifest.shots.length} screenshots per build (${manifest.diffedPerBuild} pixel-diffed, ${manifest.shots.filter((s) => s.kind === 'added').length} added, the rest unchanged); dashboard up to ${dashboardVus} VUs (${ramp}s ramps, ${hold}s hold); benchmark ${benchIterations} iterations per pair`,
  ].join('\n'),
)

if (uploads.length > 0) {
  sections.push('## Upload pipeline (k6)')
  sections.push(uploadTable(uploads))
  const failed = uploads.flatMap((u) =>
    thresholdsFailed(u.summary).map((t) => `${u.vus} concurrent: ${t}`),
  )
  if (failed.length > 0) sections.push(`Thresholds crossed: ${failed.join('; ')}`)
}

if (dashboard) {
  sections.push('## Dashboard read API (k6)')
  sections.push(dashboardTable(dashboard.summary))
  const s = dashboard.summary
  sections.push(
    `${value(s, 'dashboard_requests', 'count')} requests, ${value(s, 'http_reqs', 'rate').toFixed(0)} req/s overall, errors ${(value(s, 'errors', 'rate') * 100).toFixed(2)}%. ` +
      (thresholdsFailed(s).length === 0
        ? 'All p95 thresholds held.'
        : `Thresholds crossed: ${thresholdsFailed(s).join('; ')}.`),
  )
}

if (bench) {
  sections.push('## Diff microbenchmark (`diffImages`)')
  sections.push(benchTable(bench))
  sections.push(
    `Engine ${bench.engine}. ${bench.throughput.concurrency} pairs at a time: ${bench.throughput.pairsPerSecond.toFixed(2)} pairs/s. Process max RSS ${bench.maxRssMb.toFixed(0)} MB.`,
  )
}

sections.push('## CPU and memory')
const scopes = [
  ...uploads.map((u) => ({ scope: `upload, ${u.vus} concurrent`, usage: u.usage })),
  ...(dashboard
    ? [{ scope: 'dashboard reads', usage: sampler.usage(dashboard.startedAt, dashboard.endedAt) }]
    : []),
  { scope: 'whole run', usage: sampler.usage() },
]
sections.push(usageTable(scopes))
sections.push(
  [
    "CPU is a percentage of one core (200 = two cores busy), the delta of the process's CPU time over one-second samples; Postgres comes from `docker stats` (the Docker VM's view, a sample every ~2 s).",
    'The server (`serve`) and the worker (`worker`) are separate processes, so each row is exactly one of them; image work (sharp threads) counts under the process that runs it.',
  ].join('\n\n'),
)

await writeFile(join(outDir, 'summary.md'), `${sections.join('\n\n')}\n`)
await writeFile(
  join(outDir, 'meta.json'),
  `${JSON.stringify({ label, engine: effectiveEngine, levels, iterations, dashboardVus, ramp, hold, benchIterations, shots, manifest: RUN_MANIFEST_FILE }, null, 2)}\n`,
)
log(`Done. ${join(outDir, 'summary.md')}`)
