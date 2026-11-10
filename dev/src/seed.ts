import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { upload } from '@circi/cli'

import { COMPOSE_FILE, SEED, SERVER_MAIN, STATE_DIR, URLS, serverEnv } from './config.ts'
import { log, run } from './processes.ts'
import {
  BANNER,
  BASELINE,
  FLAKY_RUNS,
  NO_CHANGES,
  REDESIGN,
  STORYBOOK,
  type Screen,
  writeScreens,
} from './screens.ts'

/** What the seed leaves behind for later runs (`.dev/seed.json`). */
export interface SeedState {
  token: string
}

const STATE_FILE = join(STATE_DIR, 'seed.json')
const REPO = join(STATE_DIR, 'seed-repo')

/** `circi admin …` from source, against the dev database. */
export function admin(args: string[]): Promise<string> {
  return run(process.execPath, ['--conditions=@circi/source', SERVER_MAIN, 'admin', ...args], {
    env: serverEnv(),
  })
}

/** The `token` field of a JSON object (`--json` output, `.dev/seed.json`). */
function tokenIn(json: string): string {
  const parsed: unknown = JSON.parse(json)
  if (
    typeof parsed === 'object' &&
    parsed &&
    'token' in parsed &&
    typeof parsed.token === 'string'
  ) {
    return parsed.token
  }
  throw new Error(`Expected a JSON object with a token, got: ${json.slice(0, 200)}`)
}

async function isSeeded(): Promise<boolean> {
  const workspaces: unknown = JSON.parse(await admin(['workspace', 'list', '--json']))
  return (
    Array.isArray(workspaces) &&
    workspaces.some(
      (w: unknown) =>
        typeof w === 'object' && w !== null && 'slug' in w && w.slug === SEED.workspace.slug,
    )
  )
}

/**
 * Makes sure the dev database has the seed's accounts, workspace, team and builds, and returns
 * the team's CI token. Seeds once: later runs reuse `.dev/seed.json` (or rotate the token when
 * that file is gone but the data is still there).
 */
export async function ensureSeeded(): Promise<SeedState> {
  if (await isSeeded()) {
    if (existsSync(STATE_FILE)) {
      return { token: tokenIn(await readFile(STATE_FILE, 'utf8')) }
    }
    log('seed', 'Seed state missing: rotating the team token')
    const token = tokenIn(
      await admin([
        'team',
        'rotate-token',
        '--org',
        SEED.workspace.slug,
        '--team',
        SEED.team.slug,
        '--json',
      ]),
    )
    await saveState({ token })
    return { token }
  }

  log('seed', 'Empty database: creating accounts, a workspace, a team and sample builds')
  try {
    const state = await seedAccounts()
    await saveState(state)
    await seedBuilds(state.token)
    log('seed', 'Done')
    return state
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Seeding failed; \`pnpm dev:reset\` clears the partial data.\n${message}`, {
      cause: error,
    })
  }
}

async function saveState(state: SeedState): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true })
  await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`)
}

async function seedAccounts(): Promise<SeedState> {
  const { owner, member, password, workspace, team, hiddenTeam } = SEED
  const user = (who: { email: string; name: string }, extra: string[] = []) =>
    admin([
      'user',
      'create',
      '--email',
      who.email,
      '--name',
      who.name,
      '--password',
      password,
      ...extra,
    ])
  await user(owner, ['--instance-admin'])
  await user(member)
  await admin([
    'workspace',
    'create',
    '--name',
    workspace.name,
    '--slug',
    workspace.slug,
    '--owner',
    owner.email,
  ])
  await admin([
    'member',
    'add',
    '--org',
    workspace.slug,
    '--email',
    member.email,
    '--role',
    'member',
  ])
  const token = tokenIn(
    await admin([
      'team',
      'create',
      '--org',
      workspace.slug,
      '--name',
      team.name,
      '--slug',
      team.slug,
      '--member',
      owner.email,
      '--member',
      member.email,
      '--json',
    ]),
  )
  // Teams have their own members: the member is in Web app but doesn't see this one at all.
  await admin([
    'team',
    'create',
    '--org',
    workspace.slug,
    '--name',
    hiddenTeam.name,
    '--slug',
    hiddenTeam.slug,
    '--member',
    owner.email,
    '--json',
  ])
  return { token }
}

const GIT_ENV = {
  GIT_AUTHOR_NAME: SEED.owner.name,
  GIT_AUTHOR_EMAIL: SEED.owner.email,
  GIT_COMMITTER_NAME: SEED.owner.name,
  GIT_COMMITTER_EMAIL: SEED.owner.email,
}

const git = (args: string[]) => run('git', args, { cwd: REPO, env: GIT_ENV })

/** Commits on `branch` (branched from main) and returns the commit's sha. */
async function commit(branch: string, message: string): Promise<string> {
  await git(['checkout', '-q', '-B', branch, 'main'])
  await git(['commit', '-q', '--allow-empty', '-m', message])
  return git(['rev-parse', 'HEAD'])
}

async function uploadScreens(
  token: string,
  screens: Screen[],
  ci: { sha: string; branch: string; pr?: number; author: string; name?: string },
): Promise<number> {
  const dir = join(STATE_DIR, 'seed-screens', ci.sha.slice(0, 12))
  await rm(dir, { recursive: true, force: true })
  await writeScreens(dir, screens)
  const result = await upload({
    dir,
    apiUrl: URLS.server,
    token,
    wait: true,
    fetch: false,
    cwd: REPO,
    author: ci.author,
    env: {
      CIRCI_COMMIT: ci.sha,
      CIRCI_BRANCH: ci.branch,
      ...(ci.pr ? { CIRCI_PR_NUMBER: String(ci.pr), CIRCI_BASE_BRANCH: 'main' } : {}),
    },
    log: (line) => log('seed', line),
    ...(ci.name ? { name: ci.name } : {}),
  })
  if (result.exitCode === 2) throw new Error(`Upload of ${ci.branch} failed`)
  return result.build.number
}

/** Signs in through better-auth as the owner; returns the session cookie. */
async function signIn(email: string): Promise<string> {
  const res = await fetch(`${URLS.server}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: URLS.web },
    body: JSON.stringify({ email, password: SEED.password }),
  })
  if (!res.ok) throw new Error(`Sign-in as ${email} failed: HTTP ${res.status} ${await res.text()}`)
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}

async function review(
  cookie: string,
  build: number,
  state: 'approved' | 'rejected',
  reason?: string,
) {
  const { workspace, team } = SEED
  const res = await fetch(
    `${URLS.server}/api/teams/${workspace.slug}/${team.slug}/builds/${build}/review`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: URLS.web, cookie },
      body: JSON.stringify({ state, ...(reason ? { reason } : {}) }),
    },
  )
  if (!res.ok)
    throw new Error(`Review of build ${build} failed: HTTP ${res.status} ${await res.text()}`)
}

/**
 * A short history to click through: an approved baseline on main, a pull request waiting for
 * review (changed, added, removed and unchanged screens), one with no changes, and a rejected one.
 */
async function seedBuilds(token: string): Promise<void> {
  await rm(REPO, { recursive: true, force: true })
  await mkdir(REPO, { recursive: true })
  await git(['init', '-q', '-b', 'main'])
  await git(['commit', '-q', '--allow-empty', '-m', 'Initial commit'])

  const owner = await signIn(SEED.owner.email)
  const author = 'olivia'

  const base = await commit('main', 'Add the app shell')
  const baseline = await uploadScreens(token, BASELINE, { sha: base, branch: 'main', author })
  await review(owner, baseline, 'approved')
  // A pull request's ancestry is read from origin/<base>, as in a CI checkout.
  await git(['update-ref', 'refs/remotes/origin/main', 'main'])

  const quiet = await commit('fix/typos', 'Fix typos')
  await uploadScreens(token, NO_CHANGES, { sha: quiet, branch: 'fix/typos', pr: 11, author })

  const banner = await commit('feat/alert-banner', 'Show an alert banner on the dashboard')
  const rejected = await uploadScreens(token, BANNER, {
    sha: banner,
    branch: 'feat/alert-banner',
    pr: 12,
    author: 'max',
  })
  await review(
    owner,
    rejected,
    'rejected',
    'The banner covers the charts; move it below the title.',
  )

  const redesign = await commit('feat/redesign', 'Redesign home, pricing and onboarding')
  await uploadScreens(token, REDESIGN, {
    sha: redesign,
    branch: 'feat/redesign',
    pr: 13,
    author: 'max',
  })
  await git(['checkout', '-q', 'main'])
  await seedTriage(token, owner)
}

/**
 * Something in each Triage group: two flaky screens (changed back and forth on main), a
 * Storybook build with no baseline yet, and a failed build; plus a rotation (so someone is on
 * triage) and one item assigned to the member.
 */
async function seedTriage(token: string, owner: string): Promise<void> {
  for (const [i, screens] of FLAKY_RUNS.entries()) {
    // eslint-disable-next-line no-await-in-loop -- each build follows the one before on main
    const sha = await commit('main', `Tweak the dashboard (${i + 1})`)
    // eslint-disable-next-line no-await-in-loop -- in order: flakiness is about the latest builds
    await uploadScreens(token, screens, { sha, branch: 'main', author: 'olivia' })
  }

  const stories = await commit('main', 'Add Storybook')
  await uploadScreens(token, STORYBOOK, {
    sha: stories,
    branch: 'main',
    author: 'olivia',
    name: 'storybook',
  })

  // A build whose second CI shard never arrived. The worker fails such a build once its upload
  // window has passed; the seed can't wait that long, so it records the same outcome directly.
  const broken = await commit('main', 'Split the end-to-end job in two')
  const dir = join(STATE_DIR, 'seed-screens', broken.slice(0, 12))
  await rm(dir, { recursive: true, force: true })
  await writeScreens(dir, BASELINE)
  const half = await upload({
    dir,
    apiUrl: URLS.server,
    token,
    wait: false,
    fetch: false,
    cwd: REPO,
    author: 'max',
    shard: { index: 0, total: 2, nonce: 'seed-split-e2e' },
    env: { CIRCI_COMMIT: broken, CIRCI_BRANCH: 'main' },
    log: (line) => log('seed', line),
  })
  await sql(
    `update builds set status = 'error', completed_at = now(), error_message = ` +
      `'Timed out waiting for 1 of 2 shard(s): shard 2. The CI job(s) that should have uploaded them probably failed or never ran.' ` +
      `where id = '${half.build.id}'`,
  )

  const { workspace, team } = SEED
  const api = `${URLS.server}/api/teams/${workspace.slug}/${team.slug}`
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${api}${path}`, {
      method,
      headers: { 'content-type': 'application/json', origin: URLS.web, cookie: owner },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`)
    return res.status === 204 ? null : res.json()
  }
  const list: unknown = await call('GET', '/members')
  const members =
    typeof list === 'object' && list !== null && 'members' in list && Array.isArray(list.members)
      ? list.members.filter(
          (m: unknown): m is { id: string; email: string } =>
            typeof m === 'object' &&
            m !== null &&
            'id' in m &&
            typeof m.id === 'string' &&
            'email' in m &&
            typeof m.email === 'string',
        )
      : []
  const id = (email: string) => {
    const found = members.find((m) => m.email === email)
    if (!found) throw new Error(`${email} is not in ${team.slug}`)
    return found.id
  }
  const monday = new Date()
  monday.setUTCHours(0, 0, 0, 0)
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  await call('PUT', '/triage-rotation', {
    memberIds: [id(SEED.owner.email), id(SEED.member.email)],
    startsOn: monday.toISOString(),
  })
  await call('POST', '/triage/assign', {
    kind: 'flaky',
    key: 'settings/billing',
    assigneeId: id(SEED.member.email),
  })
}

/** One statement against the dev database, through the Postgres container. */
function sql(statement: string): Promise<string> {
  return run('docker', [
    'compose',
    '-f',
    COMPOSE_FILE,
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'circi',
    '-d',
    'circi',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    statement,
  ])
}
