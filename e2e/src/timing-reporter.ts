import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import type { Reporter, TestModule } from 'vitest/node'

import { ARTIFACTS_DIR, REPO_ROOT } from './paths.ts'

/**
 * Writes `e2e/.artifacts/timings.json` (per file, per test, per stack phase) and prints a summary
 * at the end of an end-to-end run: total, every file, the five slowest tests and the stack phases.
 * Registered by `vitest.config.ts` when `E2E=1`.
 */

interface StackPhases {
  team: string
  file?: string
  /** Set for a stack shared through the pool. */
  profile?: string
  up: number
  healthy: number
  setup?: number
  teardown?: number
}

export interface Timings {
  totalMs: number
  /** Every stack of the run: how many booted, and how long they took to boot (summed over workers). */
  stackCount: number
  stackBootMs: number
  stacks: StackPhases[]
  /** Highest memory use of all `circi-e2e-*` containers together, sampled with `docker stats`. */
  peakMemoryMb: number | undefined
  workers: number
  files: {
    file: string
    ms: number
    tests: number
    failed: number
    stacks: StackPhases[]
  }[]
  slowestTests: { file: string; name: string; ms: number }[]
  tests: { file: string; name: string; ms: number; state: string }[]
}

export const PHASES_FILE = join(ARTIFACTS_DIR, 'stack-phases.jsonl')

const seconds = (ms: number | undefined) => (ms === undefined ? '-' : `${(ms / 1000).toFixed(1)}s`)

function readPhases(): StackPhases[] {
  if (!existsSync(PHASES_FILE)) return []
  return readFileSync(PHASES_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StackPhases)
}

export function summarize(
  modules: readonly TestModule[],
  totalMs: number,
  peakMemoryMb?: number,
): Timings {
  const phases = readPhases()
  const tests: Timings['tests'] = []
  const files = modules.map((m) => {
    const file = relative(REPO_ROOT, m.moduleId).replace(/^e2e\/test\//, '')
    let count = 0
    let failed = 0
    for (const t of m.children.allTests()) {
      count += 1
      const state = t.result().state
      if (state === 'failed') failed += 1
      tests.push({ file, name: t.fullName, ms: Math.round(t.diagnostic()?.duration ?? 0), state })
    }
    return {
      file,
      ms: Math.round(m.diagnostic().duration),
      tests: count,
      failed,
      stacks: phases.filter((p) => p.file !== undefined && file === p.file),
    }
  })
  return {
    totalMs: Math.round(totalMs),
    stackCount: phases.length,
    stackBootMs: phases.reduce((n, p) => n + p.up + p.healthy, 0),
    stacks: phases,
    peakMemoryMb,
    workers: Number(process.env['E2E_WORKERS'] ?? 3) || 3,
    files: files.toSorted((a, b) => b.ms - a.ms),
    slowestTests: tests.toSorted((a, b) => b.ms - a.ms).slice(0, 5),
    tests,
  }
}

export function formatSummary(t: Timings): string {
  const lines = [
    '',
    `[e2e] timing summary: ${seconds(t.totalMs)} total, ${t.workers} workers, ` +
      `${t.stackCount} stacks booted (${seconds(t.stackBootMs)} of boot, summed over workers)` +
      (t.peakMemoryMb === undefined ? '' : `, peak memory ${t.peakMemoryMb} MB`),
  ]
  for (const f of t.files) {
    const boot = f.stacks.reduce((n, s) => n + s.up + s.healthy, 0)
    const teardown = f.stacks.reduce((n, s) => n + (s.teardown ?? 0), 0)
    lines.push(
      `  ${seconds(f.ms).padStart(7)}  ${f.file}  (${f.tests} tests${f.failed ? `, ${f.failed} FAILED` : ''}; ` +
        `${f.stacks.length} stack${f.stacks.length === 1 ? '' : 's'}: boot ${seconds(boot)}, teardown ${seconds(teardown)})`,
    )
  }
  const shared = t.stacks.filter((s) => s.profile)
  if (shared.length > 0) {
    lines.push('  shared stacks (booted by the first file that asked, kept for the worker):')
    for (const s of shared) {
      lines.push(
        `  ${seconds(s.up + s.healthy + (s.setup ?? 0)).padStart(7)}  ${s.profile} (${s.file ?? '?'})`,
      )
    }
  }
  lines.push('  slowest tests:')
  for (const s of t.slowestTests) lines.push(`  ${seconds(s.ms).padStart(7)}  ${s.file}: ${s.name}`)
  lines.push(`  details: e2e/.artifacts/timings.json`, '')
  return lines.join('\n')
}

/** Total memory of the run's containers right now, in MB (`docker stats`, one sample). */
function sampleMemoryMb(): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile(
      'docker',
      ['stats', '--no-stream', '--format', '{{.Name}} {{.MemUsage}}'],
      { timeout: 20_000 },
      (error, stdout) => {
        if (error) return resolve(undefined)
        let total = 0
        for (const line of stdout.split('\n')) {
          const m = /^circi-e2e-\S+ ([\d.]+)(KiB|MiB|GiB)/.exec(line)
          if (!m) continue
          total += Number(m[1]) * (m[2] === 'GiB' ? 1024 : m[2] === 'KiB' ? 1 / 1024 : 1)
        }
        resolve(Math.round(total))
      },
    )
  })
}

export class E2eTimingReporter implements Reporter {
  #start = Date.now()
  #peak: number | undefined
  #sampler: NodeJS.Timeout | undefined
  #sampling = false

  onTestRunStart(): void {
    this.#start = Date.now()
    this.#peak = undefined
    // One sample at a time (a `docker stats` call takes a couple of seconds).
    this.#sampler = setInterval(() => {
      if (this.#sampling) return
      this.#sampling = true
      void sampleMemoryMb()
        .then((mb) => {
          if (mb !== undefined && mb > (this.#peak ?? 0)) this.#peak = mb
        })
        .finally(() => {
          this.#sampling = false
        })
    }, 4_000)
    this.#sampler.unref()
  }

  onTestRunEnd(modules: readonly TestModule[]): void {
    clearInterval(this.#sampler)
    const timings = summarize(modules, Date.now() - this.#start, this.#peak)
    mkdirSync(ARTIFACTS_DIR, { recursive: true })
    writeFileSync(join(ARTIFACTS_DIR, 'timings.json'), `${JSON.stringify(timings, null, 2)}\n`)
    process.stdout.write(formatSummary(timings))
  }
}
