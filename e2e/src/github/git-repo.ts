import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

import { screenshot, type ScreenshotSpec } from '#stack/images.ts'

const exec = promisify(execFile)

/** A deterministic identity, and no influence from the developer's own git config. */
export const GIT_ENV = {
  GIT_AUTHOR_NAME: 'E2E',
  GIT_AUTHOR_EMAIL: 'e2e@example.com',
  GIT_COMMITTER_NAME: 'E2E',
  GIT_COMMITTER_EMAIL: 'e2e@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
}

/**
 * A scratch git repository whose "origin" is itself (so `origin/main` exists for the merge-base
 * the CLI computes), with a `screenshots/` folder the tests fill. Real commits and branches.
 */
export class Repo {
  readonly dir: string
  readonly shots: string

  constructor(dir: string) {
    this.dir = dir
    this.shots = join(dir, 'screenshots')
  }

  static async create(options: { branch?: string } = {}): Promise<Repo> {
    const dir = await mkdtemp(join(tmpdir(), 'circi-e2e-repo-'))
    const repo = new Repo(dir)
    await repo.git('init', '-q', '-b', options.branch ?? 'main')
    await repo.git('remote', 'add', 'origin', dir)
    await mkdir(repo.shots, { recursive: true })
    return repo
  }

  async git(...args: string[]): Promise<string> {
    const { stdout } = await exec('git', args, {
      cwd: this.dir,
      env: { ...process.env, ...GIT_ENV },
    })
    return stdout.trim()
  }

  /** Writes screenshots (name without `.png` -> spec or PNG bytes) into `screenshots/`. */
  async writeShots(shots: Record<string, ScreenshotSpec | Buffer>): Promise<void> {
    for (const [name, value] of Object.entries(shots)) {
      const file = join(this.shots, `${name}.png`)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, Buffer.isBuffer(value) ? value : await screenshot(value))
    }
  }

  async removeShot(name: string): Promise<void> {
    await rm(join(this.shots, `${name}.png`))
  }

  /** Commits everything; returns the new commit's SHA. */
  async commit(message: string): Promise<string> {
    await this.git('add', '-A')
    await this.git('commit', '-q', '--allow-empty', '-m', message)
    return this.sha()
  }

  /** `git fetch origin`, so `origin/<branch>` reflects the local branches (done before PR builds). */
  async fetch(): Promise<void> {
    await this.git('fetch', '-q', 'origin')
  }

  async checkout(branch: string, options: { create?: boolean } = {}): Promise<void> {
    await this.git('checkout', '-q', ...(options.create ? ['-b'] : []), branch)
  }

  sha(): Promise<string> {
    return this.git('rev-parse', 'HEAD')
  }

  async destroy(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true })
  }
}
