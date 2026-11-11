import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export interface Target {
  name: string
  /** A host process (the server, the worker). */
  pid?: number
  /** A Docker container (Postgres): sampled with `docker stats`, which is slower and coarser. */
  container?: string
}

export interface Sample {
  /** Epoch milliseconds. */
  at: number
  target: string
  /** 100 is one core fully busy; a process using three cores reads 300. */
  cpuPercent: number
  rssMb: number
}

export interface Usage {
  target: string
  samples: number
  avgCpu: number
  peakCpu: number
  avgRssMb: number
  peakRssMb: number
}

/** Cumulative CPU seconds and resident set size (MB) of a host process, or undefined once it's gone. */
async function readProcess(
  pid: number,
): Promise<{ cpuSeconds: number; rssMb: number } | undefined> {
  try {
    if (process.platform === 'linux') {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
      // Fields after the command name (which may hold spaces): utime and stime are the 12th and 13th.
      const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
      const ticks = Number(rest[11]) + Number(rest[12])
      const pages = Number((await readFile(`/proc/${pid}/statm`, 'utf8')).split(' ')[1])
      return { cpuSeconds: ticks / 100, rssMb: (pages * 4096) / 1_048_576 }
    }
    // macOS: ps reports the CPU time to the centisecond, so a one-second delta is good to a percent.
    const { stdout } = await exec('ps', ['-o', 'time=', '-o', 'rss=', '-p', String(pid)])
    const [time, rss] = stdout.trim().split(/\s+/)
    if (!time || !rss) return undefined
    const parts = time.split(':').map(Number)
    const seconds = parts.reduce((total, part) => total * 60 + part, 0)
    return { cpuSeconds: seconds, rssMb: Number(rss) / 1024 }
  } catch {
    return undefined
  }
}

const UNITS: Record<string, number> = { B: 1 / 1_048_576, KiB: 1 / 1024, MiB: 1, GiB: 1024 }

async function readContainer(
  name: string,
): Promise<{ cpuPercent: number; rssMb: number } | undefined> {
  try {
    const { stdout } = await exec('docker', [
      'stats',
      '--no-stream',
      '--format',
      '{{.CPUPerc}}|{{.MemUsage}}',
      name,
    ])
    const [cpu, mem] = stdout.trim().split('|')
    const used = mem
      ?.split('/')[0]
      ?.trim()
      .match(/^([\d.]+)\s*(\w+)$/)
    if (!cpu || !used?.[1] || !used[2]) return undefined
    return { cpuPercent: Number.parseFloat(cpu), rssMb: Number(used[1]) * (UNITS[used[2]] ?? 0) }
  } catch {
    return undefined
  }
}

/**
 * Samples the CPU and memory of the server, the worker and the database while a run is going:
 * one row per target per second (containers: as often as `docker stats` answers, about every
 * 2 seconds). Rows are kept in memory and written as CSV by `stop`.
 */
export class Sampler {
  readonly rows: Sample[] = []
  private readonly targets: Target[]
  private readonly intervalMs: number
  private stopped = false
  private loops: Promise<void>[] = []

  constructor(targets: Target[], intervalMs = 1000) {
    this.targets = targets
    this.intervalMs = intervalMs
  }

  start(): void {
    this.loops = this.targets.map((t) =>
      t.container === undefined ? this.watchProcess(t) : this.watchContainer(t),
    )
  }

  private async watchProcess(target: Target): Promise<void> {
    if (target.pid === undefined) return
    let previous = await readProcess(target.pid)
    let previousAt = Date.now()
    while (!this.stopped) {
      // oxlint-disable-next-line no-await-in-loop -- one sample per interval
      await new Promise((r) => setTimeout(r, this.intervalMs))
      // oxlint-disable-next-line no-await-in-loop -- as above
      const now = await readProcess(target.pid)
      const at = Date.now()
      if (now && previous) {
        const cpuPercent =
          ((now.cpuSeconds - previous.cpuSeconds) / ((at - previousAt) / 1000)) * 100
        this.rows.push({
          at,
          target: target.name,
          cpuPercent: Math.max(0, cpuPercent),
          rssMb: now.rssMb,
        })
      }
      previous = now
      previousAt = at
    }
  }

  private async watchContainer(target: Target): Promise<void> {
    if (target.container === undefined) return
    while (!this.stopped) {
      // oxlint-disable-next-line no-await-in-loop -- docker stats itself takes a second or two
      const now = await readContainer(target.container)
      if (now) this.rows.push({ at: Date.now(), target: target.name, ...now })
    }
  }

  async stop(csvPath?: string): Promise<void> {
    this.stopped = true
    await Promise.all(this.loops)
    if (csvPath) {
      const lines = this.rows.map(
        (r) =>
          `${new Date(r.at).toISOString()},${r.target},${r.cpuPercent.toFixed(1)},${r.rssMb.toFixed(1)}`,
      )
      await writeFile(csvPath, `time,target,cpu_percent,rss_mb\n${lines.join('\n')}\n`)
    }
  }

  /** Averages and peaks per target over a window (epoch milliseconds), or over the whole run. */
  usage(from = 0, to = Number.POSITIVE_INFINITY): Usage[] {
    return this.targets.map((t) => {
      const rows = this.rows.filter((r) => r.target === t.name && r.at >= from && r.at <= to)
      const sum = (pick: (r: Sample) => number) => rows.reduce((total, r) => total + pick(r), 0)
      const peak = (pick: (r: Sample) => number) => rows.reduce((m, r) => Math.max(m, pick(r)), 0)
      return {
        target: t.name,
        samples: rows.length,
        avgCpu: rows.length ? sum((r) => r.cpuPercent) / rows.length : 0,
        peakCpu: peak((r) => r.cpuPercent),
        avgRssMb: rows.length ? sum((r) => r.rssMb) / rows.length : 0,
        peakRssMb: peak((r) => r.rssMb),
      }
    })
  }
}
