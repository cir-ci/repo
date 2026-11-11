import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FIXTURES_DIR, URL_BASE } from './config.ts'
import type { FixtureFile, Manifest } from './fixtures.ts'

/**
 * The CI side of one build, as `@circi/cli`'s `upload` does it: create the build, PUT the files
 * the server asks for, finalize, poll the status. The k6 script (k6/upload.js) makes the same
 * calls; this copy seeds the stack.
 */

interface Instruction {
  sha256: string
  url: string
  method: string
  headers: Record<string, string>
  auth: 'token' | 'none'
}

export interface BuildStatus {
  build: { id: string; number: number; status: string }
  counts: { added: number; changed: number; unchanged: number; failed: number; total: number }
  outcome: { state: 'pending' | 'pass' | 'fail' }
}

async function json(res: Response, what: string): Promise<unknown> {
  const text = await res.text()
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : undefined
}

export const randomSha = (): string => randomBytes(20).toString('hex')

export interface BuildSpec {
  commitSha: string
  branch: string
  prNumber?: number
  baseSha?: string
  /** Which files make the build: a screenshot's name to its fixture file. */
  screenshots: { name: string; file: FixtureFile }[]
}

/** Uploads one build and waits for its result. */
export async function uploadBuild(token: string, spec: BuildSpec): Promise<BuildStatus> {
  const auth = { authorization: `Bearer ${token}` }
  const files = [...new Map(spec.screenshots.map((s) => [s.file.sha256, s.file])).values()]
  const created = await json(
    await fetch(`${URL_BASE}/v1/builds`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        commitSha: spec.commitSha,
        branch: spec.branch,
        prNumber: spec.prNumber ?? null,
        baseBranch: spec.prNumber ? 'main' : null,
        mergeBaseSha: spec.baseSha ?? null,
        ancestorShas: spec.baseSha ? [spec.baseSha] : [],
        ancestryStatus: 'ok',
        author: { login: 'perf-bot' },
        files: files.map((f) => ({ sha256: f.sha256, size: f.size, contentType: 'image/png' })),
      }),
    }),
    'create build',
  )
  // The API's shape is the contract (see apps/server's /v1 tests).
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const { build, uploads } = created as { build: { id: string }; uploads: Instruction[] }
  for (const u of uploads) {
    const file = files.find((f) => f.sha256 === u.sha256)
    if (!file) throw new Error(`The server asked for an unknown file ${u.sha256}`)
    // oxlint-disable-next-line no-await-in-loop -- seeding is not about speed
    const bytes = await readFile(join(FIXTURES_DIR, file.file))
    const headers = Object.fromEntries(
      Object.entries(u.headers).filter(([k]) => k.toLowerCase() !== 'content-length'),
    )
    if (u.auth === 'token') Object.assign(headers, auth)
    // oxlint-disable-next-line no-await-in-loop -- as above
    await json(await fetch(u.url, { method: u.method, headers, body: bytes }), 'upload file')
  }
  await json(
    await fetch(`${URL_BASE}/v1/builds/${build.id}/finalize`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        screenshots: spec.screenshots.map((s) => ({ name: s.name, sha256: s.file.sha256 })),
      }),
    }),
    'finalize',
  )
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- polling
    const response = await fetch(`${URL_BASE}/v1/builds/${build.id}/status`, { headers: auth })
    // oxlint-disable-next-line no-await-in-loop -- polling
    const status = await json(response, 'status')
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const typed = status as BuildStatus
    if (typed.outcome.state !== 'pending') return typed
    // oxlint-disable-next-line no-await-in-loop -- polling
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`Build ${build.id} was not processed within 3 minutes`)
}

/** The screenshots of the nth build of a series: the same names, one variant of each changed one. */
export function screenshotsFor(manifest: Manifest, variant: number) {
  return manifest.shots.map((s) => {
    const file = s.variants[variant % s.variants.length]
    if (!file) throw new Error(`No file for ${s.name}`)
    return { name: s.name, file }
  })
}

/** What the default-branch baseline holds: every screenshot that has a baseline file. */
export function baselineScreenshots(manifest: Manifest) {
  return manifest.shots.flatMap((s) => (s.baseline ? [{ name: s.name, file: s.baseline }] : []))
}
