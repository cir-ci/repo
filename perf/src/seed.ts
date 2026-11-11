import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

import { baselineScreenshots, randomSha, screenshotsFor, uploadBuild } from './ci-client.ts'
import { circi } from './circi.ts'
import { SEED, SEED_FILE, STATE_DIR, URL_BASE } from './config.ts'
import type { Manifest } from './fixtures.ts'

/** What the seed leaves in `perf/.state/seed.json` for the runner and the k6 scripts. */
export interface SeedState {
  baseUrl: string
  token: string
  email: string
  password: string
  workspace: string
  project: string
  /** The commit of the approved default-branch build that every perf build compares against. */
  baseSha: string
  historyBuilds: number
}

export async function readSeed(): Promise<SeedState> {
  // Written by `seed` below.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return JSON.parse(await readFile(SEED_FILE, 'utf8')) as SeedState
}

function stringIn(json: unknown, key: string): string {
  if (typeof json === 'object' && json !== null) {
    const value = Reflect.get(json, key)
    if (typeof value === 'string') return value
  }
  throw new Error(`Expected a string "${key}", got: ${JSON.stringify(json)?.slice(0, 200)}`)
}

/** Signs in through better-auth; returns the session cookie header. */
export async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${URL_BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: URL_BASE },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error(`Sign-in failed: HTTP ${res.status} ${await res.text()}`)
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}

async function decide(
  cookie: string,
  buildNumber: number,
  state: 'approved' | 'rejected',
): Promise<void> {
  const res = await fetch(
    `${URL_BASE}/api/projects/${SEED.workspace.slug}/${SEED.project.slug}/builds/${buildNumber}/review`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: URL_BASE, cookie },
      body: JSON.stringify(state === 'rejected' ? { state, reason: 'Perf seed' } : { state }),
    },
  )
  if (!res.ok) throw new Error(`Review: HTTP ${res.status} ${await res.text()}`)
}

/**
 * An account, a workspace, a project and its CI token (the `circi admin` commands, as an operator
 * runs them), an approved baseline build on `main`, and a few reviewed pull-request builds so the
 * dashboard has something to list. Seeds once; later starts reuse `perf/.state/seed.json`.
 */
export async function seed(
  manifest: Manifest,
  options: { history?: number; log: (line: string) => void },
): Promise<SeedState> {
  if (existsSync(SEED_FILE)) return readSeed()
  const { log } = options
  const history = options.history ?? 4
  await mkdir(STATE_DIR, { recursive: true })

  log('Seeding: account, workspace, project, token')
  await circi([
    'admin',
    'user',
    'create',
    '--email',
    SEED.email,
    '--name',
    'Perf Owner',
    '--password',
    SEED.password,
    '--instance-admin',
    '--json',
  ])
  await circi([
    'admin',
    'workspace',
    'create',
    '--name',
    SEED.workspace.name,
    '--slug',
    SEED.workspace.slug,
    '--owner',
    SEED.email,
  ])
  const created = await circi([
    'admin',
    'project',
    'create',
    '--org',
    SEED.workspace.slug,
    '--name',
    SEED.project.name,
    '--slug',
    SEED.project.slug,
    '--json',
  ])
  const token = stringIn(JSON.parse(created), 'token')

  log('Seeding: the baseline build on main (approved)')
  const cookie = await signIn(SEED.email, SEED.password)
  const baseSha = randomSha()
  const baseline = await uploadBuild(token, {
    commitSha: baseSha,
    branch: 'main',
    screenshots: baselineScreenshots(manifest),
  })
  await decide(cookie, baseline.build.number, 'approved')

  log(`Seeding: ${history} pull-request builds, reviewed alternately`)
  for (let i = 0; i < history; i += 1) {
    // oxlint-disable-next-line no-await-in-loop -- one build at a time, like a quiet CI
    const result = await uploadBuild(token, {
      commitSha: randomSha(),
      branch: `seed/${i}`,
      prNumber: 100 + i,
      baseSha,
      screenshots: screenshotsFor(manifest, manifest.variantCount - 1 - i),
    })
    if (i % 4 !== 3) {
      // oxlint-disable-next-line no-await-in-loop -- as above
      await decide(cookie, result.build.number, i % 2 === 0 ? 'approved' : 'rejected')
    }
  }

  const state: SeedState = {
    baseUrl: URL_BASE,
    token,
    email: SEED.email,
    password: SEED.password,
    workspace: SEED.workspace.slug,
    project: SEED.project.slug,
    baseSha,
    historyBuilds: history,
  }
  await writeFile(SEED_FILE, `${JSON.stringify(state, null, 2)}\n`)
  return state
}
