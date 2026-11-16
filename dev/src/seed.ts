import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { upload } from '@circi/cli'

import {
  COMPOSE_FILE,
  PEOPLE,
  PROJECTS,
  SEED,
  SERVER_MAIN,
  STATE_DIR,
  URLS,
  WEBHOOK_SECRETS_FILE,
  WORKSPACES,
  serverEnv,
  type PersonKey,
  type SeedProject,
  type SeedWorkspace,
} from './config.ts'
import { HISTORY, type Step } from './history.ts'
import { log, run } from './processes.ts'
import { writeScreens } from './screens.ts'

/** What the seed leaves behind for later runs (`.dev/seed.json`). */
export interface SeedState {
  token: string
}

const STATE_FILE = join(STATE_DIR, 'seed.json')
const REPOS = join(STATE_DIR, 'seed-repos')

/** `circi admin …` from source, against the dev database. */
export function admin(args: string[]): Promise<string> {
  return run(process.execPath, ['--conditions=@circi/source', SERVER_MAIN, 'admin', ...args], {
    env: serverEnv(),
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value))
  throw new Error(`Expected an object, got: ${JSON.stringify(value)?.slice(0, 200)}`)
}

/** The string field `key` of a JSON object (`--json` output, `.dev/seed.json`, API replies). */
function stringIn(json: unknown, key: string): string {
  const value = asRecord(json)[key]
  if (typeof value === 'string') return value
  throw new Error(`Expected a string "${key}", got: ${JSON.stringify(json)?.slice(0, 200)}`)
}

const tokenIn = (json: string): string => stringIn(JSON.parse(json), 'token')

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
 * Makes sure the dev database has the seed's accounts, workspaces, projects and builds, and
 * returns the Web app's CI token. Seeds once: later runs reuse `.dev/seed.json` (or rotate the
 * token when that file is gone but the data is still there).
 */
export async function ensureSeeded(): Promise<SeedState> {
  if (await isSeeded()) {
    if (existsSync(STATE_FILE)) {
      return { token: tokenIn(await readFile(STATE_FILE, 'utf8')) }
    }
    log('seed', 'Seed state missing: rotating the project token')
    const token = tokenIn(
      await admin([
        'project',
        'rotate-token',
        '--org',
        SEED.workspace.slug,
        '--project',
        SEED.project.slug,
        '--json',
      ]),
    )
    await saveState({ token })
    return { token }
  }

  log('seed', 'Empty database: creating accounts, workspaces, projects and a history of builds')
  const started = Date.now()
  try {
    const world = await seedPeopleAndProjects()
    const state = { token: world.tokens.get(SEED.project.slug) ?? '' }
    await saveState(state)
    await seedHistory(world)
    await seedActivity(world)
    log('seed', `Done in ${Math.round((Date.now() - started) / 1000)}s`)
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

/** What the later steps need to know about what exists. */
interface World {
  ids: Map<PersonKey, string>
  /** Project slug to its CI token. */
  tokens: Map<string, string>
  workspaceIds: Map<string, string>
}

const workspaceOf = (slug: string): SeedWorkspace => {
  const found = WORKSPACES.find((w) => w.slug === slug)
  if (!found) throw new Error(`Unknown workspace ${slug}`)
  return found
}

const isPersonKey = (key: string): key is PersonKey => key in PEOPLE
const personKeys = Object.keys(PEOPLE).filter(isPersonKey)

// ---------------------------------------------------------------------------------------------
// Accounts, workspaces and projects: the `circi admin` commands, as an operator would run them.
// ---------------------------------------------------------------------------------------------

async function seedPeopleAndProjects(): Promise<World> {
  const ids = new Map<PersonKey, string>()
  const createUser = async (key: PersonKey) => {
    const who = PEOPLE[key]
    const extra = key === 'owner' || key === 'ines' ? ['--instance-admin'] : []
    const out = await admin([
      'user',
      'create',
      '--email',
      who.email,
      '--name',
      who.name,
      '--password',
      SEED.password,
      '--json',
      ...extra,
    ])
    ids.set(key, stringIn(JSON.parse(out), 'id'))
  }
  // The first account is created alone: it is the one that opens the instance.
  await createUser('owner')
  await Promise.all(personKeys.filter((k) => k !== 'owner').map(createUser))

  await Promise.all(
    WORKSPACES.map((w) =>
      admin([
        'workspace',
        'create',
        '--name',
        w.name,
        '--slug',
        w.slug,
        '--owner',
        PEOPLE[w.owner].email,
      ]),
    ),
  )
  await Promise.all(
    WORKSPACES.flatMap((w) =>
      w.members.map((m) =>
        admin(['member', 'add', '--org', w.slug, '--email', PEOPLE[m.who].email, '--role', m.role]),
      ),
    ),
  )

  const tokens = new Map<string, string>()
  await Promise.all(
    PROJECTS.map(async (p) => {
      const out = await admin([
        'project',
        'create',
        '--org',
        p.workspace,
        '--name',
        p.name,
        '--slug',
        p.slug,
        ...p.members.flatMap((m) => ['--member', PEOPLE[m].email]),
        '--json',
      ])
      tokens.set(p.slug, tokenIn(out))
    }),
  )

  const listed: unknown = JSON.parse(await admin(['workspace', 'list', '--json']))
  const workspaceIds = new Map<string, string>()
  if (Array.isArray(listed)) {
    for (const w of listed) workspaceIds.set(stringIn(w, 'slug'), stringIn(w, 'id'))
  }
  return { ids, tokens, workspaceIds }
}

// ---------------------------------------------------------------------------------------------
// The dashboard's own API, signed in as one of the seeded people.
// ---------------------------------------------------------------------------------------------

const sessions = new Map<PersonKey, Promise<string>>()

/** Signs in through better-auth; returns the session cookie (one sign-in per person). */
function cookieFor(who: PersonKey): Promise<string> {
  let session = sessions.get(who)
  if (!session) {
    session = (async () => {
      const email = PEOPLE[who].email
      const res = await fetch(`${URLS.server}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: URLS.web },
        body: JSON.stringify({ email, password: SEED.password }),
      })
      if (!res.ok) {
        throw new Error(`Sign-in as ${email} failed: HTTP ${res.status} ${await res.text()}`)
      }
      return res.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; ')
    })()
    sessions.set(who, session)
  }
  return session
}

/** One call to `/api<path>` as `who`; the parsed reply, or null when there is none. */
async function call(
  who: PersonKey,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${URLS.server}/api${path}`, {
    method,
    headers: {
      // A JSON type only with a body: the server refuses an empty body declared as JSON.
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      origin: URLS.web,
      cookie: await cookieFor(who),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`)
  const text = await res.text()
  return text ? (JSON.parse(text) as unknown) : null
}

const idOf = (key: PersonKey, world: World): string => {
  const id = world.ids.get(key)
  if (!id) throw new Error(`No account for ${key}`)
  return id
}

const projectPath = (p: { workspace: string; slug: string }) => `/projects/${p.workspace}/${p.slug}`

function mondayOfThisWeek(): string {
  const monday = new Date()
  monday.setUTCHours(0, 0, 0, 0)
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  return monday.toISOString()
}

/** Looks, settings, review rules, the triage rotation and pins of one project. */
async function configureProject(p: SeedProject, world: World): Promise<void> {
  const actor = workspaceOf(p.workspace).owner
  const base = projectPath(p)
  await call(actor, 'PATCH', `${base}/appearance`, { color: p.color, icon: p.icon })
  // Builds up to three months old stay until the seed's data is wiped.
  await call(actor, 'PATCH', `${base}/settings`, {
    retentionDays: 365,
    ...p.settings,
    ...(p.reviewOverdueNotify
      ? { reviewOverdueNotifyUserId: idOf(p.reviewOverdueNotify, world) }
      : {}),
  })
  for (const rule of p.rules) {
    // eslint-disable-next-line no-await-in-loop -- rules are ordered: the first match wins
    await call(actor, 'POST', `${base}/rules`, {
      kind: rule.kind,
      pattern: rule.pattern,
      reviewerIds: rule.reviewers.map((r) => idOf(r, world)),
    })
  }
  if (p.rotation.length > 0) {
    await call(actor, 'PUT', `${base}/triage-rotation`, {
      memberIds: p.rotation.map((m) => idOf(m, world)),
      startsOn: mondayOfThisWeek(),
    })
  }
  await Promise.all([
    ...p.pinnedBy.map((who) =>
      call(who, 'PUT', `/workspaces/${p.workspace}/pinned-projects/${p.slug}`),
    ),
    ...(p.ignore ?? []).map((region) => call(actor, 'POST', `${base}/ignore-regions`, region)),
  ])
}

// ---------------------------------------------------------------------------------------------
// Builds: the real CLI upload from a git repository per project, then the reviewers' decisions.
// ---------------------------------------------------------------------------------------------

/** A build the seed made, for the backdating at the end. */
interface Built {
  workspace: string
  step: Step
  number: number
}

const gitFor = (repo: string, env: Record<string, string>) => (args: string[]) =>
  run('git', args, { cwd: repo, env })

/** A step with its commit, made up front so the uploads of independent builds can run side by side. */
interface Planned {
  step: Step
  sha: string
  author: (typeof PEOPLE)[PersonKey]
}

/** How many pull requests of one project upload at the same time (the builds on main go one by one). */
const WAVE = 4

/**
 * The steps in groups that can upload together: a build on main, a re-run, a build left half
 * uploaded or a second push to a branch is compared with what the one before it left, so it starts
 * a group of its own; pull requests of different branches only read main and share one.
 */
function waves(planned: Planned[]): Planned[][] {
  const groups: Planned[][] = []
  let current: Planned[] = []
  const flush = () => {
    if (current.length > 0) groups.push(current)
    current = []
  }
  for (const item of planned) {
    const alone = item.step.branch === 'main' || item.step.rerun === true
    if (alone) {
      flush()
      groups.push([item])
    } else {
      if (current.length >= WAVE || current.some((c) => c.step.branch === item.step.branch)) flush()
      current.push(item)
    }
  }
  flush()
  return groups
}

async function seedProjectHistory(p: SeedProject, steps: Step[], world: World): Promise<Built[]> {
  const token = world.tokens.get(p.slug)
  if (!token) throw new Error(`No token for ${p.slug}`)
  const repo = join(REPOS, p.slug)
  await rm(repo, { recursive: true, force: true })
  await mkdir(repo, { recursive: true })
  const initial = gitFor(repo, {
    GIT_AUTHOR_NAME: PEOPLE.owner.name,
    GIT_AUTHOR_EMAIL: PEOPLE.owner.email,
    GIT_COMMITTER_NAME: PEOPLE.owner.name,
    GIT_COMMITTER_EMAIL: PEOPLE.owner.email,
  })
  await initial(['init', '-q', '-b', 'main'])
  await initial(['commit', '-q', '--allow-empty', '-m', 'Initial commit'])

  // Oldest first, so build numbers follow the dates.
  const ordered = steps.toSorted((a, b) => b.daysAgo - a.daysAgo)
  const planned: Planned[] = []
  const lastShaOf = new Map<string, string>()
  for (const [index, step] of ordered.entries()) {
    const author = PEOPLE[step.author]
    let sha: string | undefined
    if (step.rerun) {
      // CI runs the same commit again.
      sha = lastShaOf.get(step.branch)
    } else if (step.noAncestry) {
      // A commit this checkout doesn't have, so there is no history to find a baseline in.
      sha = createHash('sha1').update(`${p.slug}-${step.branch}-${index}`).digest('hex')
    } else {
      const git = gitFor(repo, {
        GIT_AUTHOR_NAME: author.name,
        GIT_AUTHOR_EMAIL: author.email,
        GIT_COMMITTER_NAME: author.name,
        GIT_COMMITTER_EMAIL: author.email,
      })
      // eslint-disable-next-line no-await-in-loop -- each commit branches from the one before on main
      await git(['checkout', '-q', '-B', step.branch, 'main'])
      // eslint-disable-next-line no-await-in-loop -- as above
      await git(['commit', '-q', '--allow-empty', '-m', step.message])
      // eslint-disable-next-line no-await-in-loop -- as above
      sha = await git(['rev-parse', 'HEAD'])
      if (step.branch === 'main') {
        // A pull request's ancestry is read from origin/<base>, as in a CI checkout.
        // eslint-disable-next-line no-await-in-loop -- as above
        await git(['update-ref', 'refs/remotes/origin/main', 'main'])
      }
    }
    if (!sha) throw new Error(`${p.slug}: no commit to run again on ${step.branch}`)
    lastShaOf.set(step.branch, sha)
    planned.push({ step, sha, author })
  }
  await run('git', ['checkout', '-q', 'main'], { cwd: repo })

  const built: Built[] = []
  for (const group of waves(planned)) {
    // eslint-disable-next-line no-await-in-loop -- a group needs the builds before it to be done
    const results = await Promise.all(group.map((item) => uploadStep(p, item, repo, token, world)))
    built.push(...results)
  }
  return built
}

async function uploadStep(
  p: SeedProject,
  { step, sha, author }: Planned,
  repo: string,
  token: string,
  world: World,
): Promise<Built> {
  const dir = join(
    STATE_DIR,
    'seed-screens',
    `${p.slug}-${sha.slice(0, 12)}${step.rerun ? '-rerun' : ''}`,
  )
  await rm(dir, { recursive: true, force: true })
  await writeScreens(dir, step.screens)
  const ci = {
    cwd: repo,
    dir,
    apiUrl: URLS.server,
    token,
    fetch: false,
    pollIntervalMs: 100,
    log: (line: string) => log('seed', `${p.slug}: ${line}`),
    env: {
      // Buildkite's variables carry the author's name and email, which the server matches to a member.
      BUILDKITE: 'true',
      BUILDKITE_BUILD_AUTHOR: author.name,
      BUILDKITE_BUILD_AUTHOR_EMAIL: author.email,
      CIRCI_COMMIT: sha,
      CIRCI_BRANCH: step.branch,
      ...(step.pr ? { CIRCI_PR_NUMBER: String(step.pr), CIRCI_BASE_BRANCH: 'main' } : {}),
    },
    ...(step.name ? { name: step.name } : {}),
  }
  let number: number
  if (step.failed || step.partial) {
    // A build whose second CI shard never arrived. The worker fails such a build once its upload
    // window has passed; the seed can't wait that long, so a failed one gets the same outcome
    // with SQL (see `backdate`) and a partial one is left "uploading".
    const half = await upload({
      ...ci,
      wait: false,
      shard: { index: 0, total: 2, nonce: `seed-${p.slug}-${sha.slice(0, 8)}` },
    })
    number = half.build.number
  } else {
    const result = await upload({ ...ci, wait: true })
    // A build with a corrupt screenshot (`broken`) ends with exit 2 on a blocking project: that is
    // the state it is seeded to show, so only a build the server couldn't process stops the seed.
    const unreadableOnly =
      result.status?.unreadable.length && result.status.build.status !== 'error'
    if (result.exitCode === 2 && !unreadableOnly)
      throw new Error(`Upload of ${p.slug} ${step.branch} failed`)
    number = result.build.number
  }
  await interact(p, step, number, world)
  return { workspace: p.workspace, step, number }
}

/**
 * What people did with a build: asked for reviews, commented, decided. Each is tolerant: whether a
 * build has changes to review is decided by the server's diff, so a step the history meant as a
 * change can come out with none; that call is skipped and logged rather than stopping the seed.
 */
async function interact(p: SeedProject, step: Step, number: number, world: World): Promise<void> {
  const base = `${projectPath(p)}/builds/${number}`
  for (const reviewer of step.requests) {
    // eslint-disable-next-line no-await-in-loop -- a few calls, in the order they happened
    await tolerant(`review request on ${base}`, () =>
      call(step.author, 'POST', `${base}/review-requests`, { reviewerId: idOf(reviewer, world) }),
    )
  }
  let lastThread: string | undefined
  for (const c of step.comments) {
    // eslint-disable-next-line no-await-in-loop -- replies need their thread's ID
    await tolerant(`comment on ${base}`, async () => {
      const made = await call(c.by, 'POST', `${base}/comments`, {
        body: c.body,
        ...(c.snapshot ? { snapshotName: c.snapshot } : {}),
        ...(c.region ? { region: c.region, regionSide: 'current' } : {}),
        ...(c.reply && lastThread ? { parentId: lastThread } : {}),
      })
      if (!c.reply) lastThread = stringIn(asRecord(made).comment ?? made, 'id')
    })
  }
  for (const r of step.snapshotReviews) {
    // eslint-disable-next-line no-await-in-loop -- decisions in the order they were made
    await tolerant(`snapshot review of ${base}`, () =>
      call(r.by, 'POST', `${base}/snapshots/review`, {
        snapshotNames: r.names,
        decision: r.decision,
        ...(r.reason ? { reason: r.reason } : {}),
      }),
    )
  }
  for (const r of step.reviews) {
    // eslint-disable-next-line no-await-in-loop -- as above
    await tolerant(`review of ${base}`, () =>
      call(r.by, 'POST', `${base}/review`, {
        state: r.state,
        ...(r.reason ? { reason: r.reason } : {}),
      }),
    )
  }
}

/** Every project's builds, the projects in parallel (the builds of one follow each other on main). */
async function seedHistory(world: World): Promise<void> {
  await Promise.all(
    WORKSPACES.flatMap((w) =>
      w.settings ? [call(w.owner, 'PATCH', `/workspaces/${w.slug}/settings`, w.settings)] : [],
    ),
  )
  await Promise.all(PROJECTS.map((p) => configureProject(p, world)))
  const projects = PROJECTS.filter((p) => HISTORY[p.slug])
  const results = await Promise.all(
    projects.map(async (p) => {
      const built = await seedProjectHistory(p, HISTORY[p.slug] ?? [], world)
      log('seed', `${p.workspace}/${p.slug}: ${built.length} builds`)
      return built
    }),
  )
  await backdate(results.flat())
  // Retention as an operator runs it (`circi admin storage gc`): builds older than their project's
  // retention expire (the project with a 30-day retention has some).
  const gc = await admin(['storage', 'gc'])
  log('seed', `Retention expired ${String(asRecord(JSON.parse(gc)).expiredBuilds)} builds`)
}

// ---------------------------------------------------------------------------------------------
// Triage, saved views, webhooks, invitations, domains and a deleted workspace.
// ---------------------------------------------------------------------------------------------

/** Runs `fn`; a failure is only logged (for extras that depend on what the history produced). */
async function tolerant(what: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // A build whose diff came out empty (below the threshold) has nothing to decide: expected.
    if (message.includes('has no changes to review')) return
    log('seed', `Skipped ${what}: ${message}`)
  }
}

const view = (who: PersonKey, workspace: string, body: Record<string, unknown>) =>
  call(who, 'POST', `/workspaces/${workspace}/views`, body)

async function seedActivity(world: World): Promise<void> {
  await seedReviewActivity(world)
  // Triage: flaky screens handed to people.
  const triage = (
    who: PersonKey,
    project: string,
    key: string,
    assignee: PersonKey,
    workspace = 'acme',
  ) =>
    tolerant(`triage of ${key}`, () =>
      call(who, 'POST', `/projects/${workspace}/${project}/triage/assign`, {
        kind: 'flaky',
        key,
        assigneeId: idOf(assignee, world),
      }),
    )
  await Promise.all([
    triage('owner', 'web-app', 'settings/billing', 'member'),
    triage('owner', 'web-app', 'dashboard/overview', 'priya'),
    triage('tomas', 'mobile-web', 'm/cart', 'liam'),
  ])

  // Saved views, which are private to each person.
  await Promise.all([
    view('owner', 'acme', { name: 'Needs review', filters: { review: 'pending' }, pinned: true }),
    view('owner', 'acme', {
      name: 'Changes requested',
      filters: { review: 'rejected' },
      pinned: true,
    }),
    view('owner', 'acme', { name: 'Feature branches', filters: { branchContains: 'feat/' } }),
    view('owner', 'acme', {
      name: 'Web app failures',
      project: 'web-app',
      filters: { status: 'error' },
    }),
    view('member', 'acme', { name: 'Needs review', filters: { review: 'pending' }, pinned: true }),
    view('member', 'acme', { name: 'Failed builds', filters: { status: 'error' } }),
    view('member', 'acme', { name: 'Rejected', filters: { review: 'rejected' } }),
    view('member', 'acme', {
      name: 'Stuck uploads',
      project: 'mobile-web',
      filters: { status: 'uploading' },
    }),
    view('owner', 'acme', {
      name: 'Expired in Admin console',
      project: 'admin-console',
      filters: { status: 'expired' },
    }),
    view('owner', 'acme', {
      name: 'Gallery to review',
      project: 'component-gallery',
      filters: { review: 'pending' },
      pinned: true,
    }),
    view('priya', 'acme', { name: 'Approved', filters: { review: 'approved' } }),
    view('elena', 'northwind', {
      name: 'Needs review',
      filters: { review: 'pending' },
      pinned: true,
    }),
  ])

  // Webhooks at the dev receiver, added now so they don't deliver for every build above; each gets
  // a test event, so the delivery list has one (the one at /fail/always fails on purpose, so
  // its list shows failures and retries). The receiver checks signatures with the secrets saved
  // here, by path.
  const made = await Promise.all(
    PROJECTS.flatMap((p) =>
      (p.webhooks ?? []).map(async (hook) => {
        const owner = workspaceOf(p.workspace).owner
        const created = await call(owner, 'POST', `${projectPath(p)}/webhooks`, hook)
        const id = stringIn(asRecord(asRecord(created).webhook), 'id')
        return {
          owner,
          hookPath: new URL(hook.url).pathname,
          path: `${projectPath(p)}/webhooks/${id}/test`,
          secret: stringIn(created, 'secret'),
        }
      }),
    ),
  )
  // The secrets first, so the receiver can check the test events' signatures.
  await writeFile(
    WEBHOOK_SECRETS_FILE,
    JSON.stringify(Object.fromEntries(made.map((m) => [m.hookPath, m.secret]))),
    { mode: 0o600 },
  )
  // `mode` applies only to a new file: an older one keeps its permissions otherwise.
  await chmod(WEBHOOK_SECRETS_FILE, 0o600)
  await Promise.all(made.map((m) => call(m.owner, 'POST', m.path)))

  // Invitations that stay pending (better-auth's own endpoint, which also sends the email).
  for (const w of WORKSPACES) {
    const workspaceId = world.workspaceIds.get(w.slug)
    for (const invite of w.invitations ?? []) {
      // eslint-disable-next-line no-await-in-loop -- a single invitation
      await call(w.owner, 'POST', '/auth/organization/invite-member', {
        email: invite.email,
        role: invite.role,
        organizationId: workspaceId,
      })
    }
  }

  // A claimed email domain. Verifying it needs a DNS record, so the seed marks it verified.
  for (const w of WORKSPACES) {
    if (!w.domain) continue
    // eslint-disable-next-line no-await-in-loop -- one domain per workspace
    await call(w.owner, 'POST', `/workspaces/${w.slug}/domains`, { domain: w.domain })
    // eslint-disable-next-line no-await-in-loop -- as above
    await sql(
      `update workspace_domains set verified_at = now() - interval '12 days' ` +
        `where domain = ${quote(w.domain)} and verified_at is null`,
    )
  }

  // Older notices were read long ago: only the recent ones are unread in the inbox.
  await sql(
    `update notifications set read_at = created_at + interval '3 hours' ` +
      `where read_at is null and created_at < now() - interval '7 days'`,
  )

  // Deleted last: its owner deletes it with its address typed in, as the dashboard asks.
  for (const w of WORKSPACES.filter((x) => x.deleted)) {
    // eslint-disable-next-line no-await-in-loop -- one workspace
    await call(w.owner, 'DELETE', `/workspaces/${w.slug}`, { confirm: w.slug })
  }
  await sql(
    `update workspace_deletions set deleted_at = now() - interval '9 days' ` +
      `where workspace_id in (select id from workspace where slug = 'old-labs')`,
  )
}

// ---------------------------------------------------------------------------------------------
// Dates. Everything above happened within a minute, so the history is moved back with SQL.
// ---------------------------------------------------------------------------------------------

const quote = (text: string) => `'${text.replaceAll("'", "''")}'`
const DAY_SECONDS = 86_400

/**
 * Spreads the builds over the last three months: each build's own timestamps (the ones Insights
 * and the date filters read: `completed_at`, which falls back to `created_at`), its reviews (the
 * time to a decision), its comments, and what came with it (screenshots, review requests,
 * inbox notices). A failed build is marked failed here (see `seedProjectHistory`).
 */
async function backdate(built: Built[]): Promise<void> {
  const rows = built.map((b) => {
    const first = b.step.reviews[0]
    return `(${quote(b.workspace)}, ${quote(b.step.project)}, ${b.number}::int, ${Math.round(b.step.daysAgo * DAY_SECONDS)}::int, ${b.step.failed === true}::boolean, ${first ? `${first.hours}::numeric` : 'null::numeric'})`
  })
  const commentRows = built.flatMap((b) =>
    b.step.comments.map(
      (c, i) =>
        `(${quote(b.workspace)}, ${quote(b.step.project)}, ${b.number}::int, ${i + 1}::int, ${c.hours}::numeric)`,
    ),
  )
  await sql(
    [
      `create temp table seed_builds as
        select b.id as build_id, v.ws, v.slug, v.num, v.failed, v.hours,
          now() - v.secs * interval '1 second' as ready,
          now() - v.secs * interval '1 second' - coalesce(b.completed_at, b.created_at) as delta
        from (values ${rows.join(', ')}) as v(ws, slug, num, secs, failed, hours)
        join workspace w on w.slug = v.ws
        join projects p on p.workspace_id = w.id and p.slug = v.slug
        join builds b on b.project_id = p.id and b.number = v.num`,
      // A person's decision lands `hours` after the build was ready; automatic ones with the build.
      `update reviews r set created_at = case
          when r.user_id is not null and d.hours is not null then d.ready + d.hours * interval '1 hour'
          else r.created_at + d.delta end
        from seed_builds d where r.build_id = d.build_id`,
      `update snapshot_reviews s set
          created_at = s.created_at + d.delta + case when s.user_id is not null then coalesce(d.hours, 0) * interval '1 hour' else interval '0' end,
          superseded_at = s.superseded_at + d.delta + case when s.user_id is not null then coalesce(d.hours, 0) * interval '1 hour' else interval '0' end
        from seed_builds d where s.build_id = d.build_id`,
      ...(commentRows.length > 0
        ? [
            `create temp table seed_comments as
              select d.build_id, v.ord, v.hours
              from (values ${commentRows.join(', ')}) as v(ws, slug, num, ord, hours)
              join seed_builds d on d.ws = v.ws and d.slug = v.slug and d.num = v.num`,
            `update comments c set created_at = d.ready + h.hours * interval '1 hour'
              from (select id, build_id, row_number() over (partition by build_id order by created_at, id) as ord from comments) o
              join seed_builds d on d.build_id = o.build_id
              join seed_comments h on h.build_id = o.build_id and h.ord = o.ord
              where c.id = o.id`,
          ]
        : []),
      `update screenshots x set created_at = x.created_at + d.delta from seed_builds d where x.build_id = d.build_id`,
      `update screenshot_diffs x set created_at = x.created_at + d.delta from seed_builds d where x.build_id = d.build_id`,
      `update review_requests q set created_at = q.created_at + d.delta, due_at = q.due_at + d.delta,
          closed_at = q.closed_at + d.delta
        from seed_builds d where q.build_id = d.build_id`,
      `update notifications n set created_at = n.created_at + d.delta + case n.kind
          when 'build_approved' then coalesce(d.hours, 1) * interval '1 hour'
          when 'build_rejected' then coalesce(d.hours, 1) * interval '1 hour'
          when 'mentioned' then interval '2 hours'
          else interval '0' end
        from seed_builds d where n.build_id = d.build_id`,
      `update builds b set created_at = d.ready - interval '90 seconds',
          finalized_at = case when b.finalized_at is null then null else d.ready - interval '45 seconds' end,
          completed_at = case when b.status in ('pending', 'uploading', 'processing') then null else d.ready end
        from seed_builds d where b.id = d.build_id`,
      `update builds b set status = 'error', completed_at = d.ready,
          error_message = 'Timed out waiting for 1 of 2 shard(s): shard 2. The CI job(s) that should have uploaded them probably failed or never ran.'
        from seed_builds d where b.id = d.build_id and d.failed`,
    ].join(';\n'),
  )
}

/** One statement (or several, in one session) against the dev database, through the Postgres container. */
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

// ---------------------------------------------------------------------------------------------
// What people did with their Reviews and Inbox: snoozes, dismissals, nudges, triage choices.
// ---------------------------------------------------------------------------------------------

interface OpenRequest {
  id: string
  workspace: string
  project: string
  requestedById: string | null
  overdueByMs: number
}

async function openRequests(who: PersonKey, tab: string): Promise<OpenRequest[]> {
  const list = asRecord(await call(who, 'GET', `/reviews?tab=${tab}`))
  const requests = Array.isArray(list.requests) ? list.requests : []
  return requests.map((r: unknown) => {
    const row = asRecord(r)
    const requester = row.requestedBy === null ? null : asRecord(row.requestedBy)
    return {
      id: stringIn(row, 'id'),
      workspace: stringIn(row.workspace, 'slug'),
      project: stringIn(row.project, 'slug'),
      requestedById: requester ? stringIn(requester, 'id') : null,
      overdueByMs: typeof row.overdueByMs === 'number' ? row.overdueByMs : 0,
    }
  })
}

const requestPath = (r: OpenRequest) =>
  `/projects/${r.workspace}/${r.project}/review-requests/${r.id}`

/** Reviewers put some requests off, drop one, and the ones who asked nudge an overdue one. */
async function seedReviewActivity(world: World): Promise<void> {
  const kinds = ['tomorrow', 'next_week', 'next_push'] as const
  const reviewers: PersonKey[] = ['owner', 'member', 'priya', 'daniel', 'sofia']
  const lists = await Promise.all(reviewers.map((who) => openRequests(who, 'for-you')))
  const jobs: Promise<unknown>[] = []
  for (const [i, who] of reviewers.entries()) {
    const open = lists[i] ?? []
    // The first (most urgent) stays open; the next ones are snoozed, one dropped.
    for (const [k, request] of open.slice(1, 4).entries()) {
      jobs.push(
        tolerant(`snooze of ${request.id}`, () =>
          call(who, 'POST', `${requestPath(request)}/snooze`, { kind: kinds[k % kinds.length] }),
        ),
      )
    }
    const dropped = open[4]
    if (dropped) {
      jobs.push(
        tolerant(`dismissal of ${dropped.id}`, () =>
          call(who, 'POST', `${requestPath(dropped)}/dismiss`),
        ),
      )
    }
  }
  await Promise.all(jobs)
  // Whoever asked tells an overdue reviewer again.
  const asked = await Promise.all(reviewers.map((who) => openRequests(who, 'all-open')))
  const nudges = asked
    .flat()
    .filter((r) => r.overdueByMs > 0 && r.requestedById)
    .slice(0, 4)
  await Promise.all(
    nudges.map((r) => {
      const asker = [...world.ids.entries()].find(([, id]) => id === r.requestedById)?.[0]
      return asker
        ? tolerant(`nudge of ${r.id}`, () => call(asker, 'POST', `${requestPath(r)}/nudge`))
        : Promise.resolve()
    }),
  )

  // Inbox: some notices snoozed (the Snoozed tab), some marked read, one removed.
  const inboxers: PersonKey[] = ['owner', 'member', 'priya', 'daniel']
  await Promise.all(
    inboxers.map(async (who) => {
      const list = asRecord(await call(who, 'GET', '/inbox?tab=for-you'))
      const items = (Array.isArray(list.items) ? list.items : []).map((x: unknown) =>
        stringIn(x, 'id'),
      )
      const choices = ['tomorrow', 'next_week'] as const
      await Promise.all([
        ...items
          .slice(1, 3)
          .map((id, k) =>
            tolerant(`inbox snooze ${id}`, () =>
              call(who, 'POST', `/inbox/${id}/snooze`, { choice: choices[k % 2] }),
            ),
          ),
        ...items
          .slice(4, 6)
          .map((id) =>
            tolerant(`inbox read ${id}`, () =>
              call(who, 'POST', `/inbox/${id}/read`, { read: true }),
            ),
          ),
        ...items
          .slice(6, 7)
          .map((id) => tolerant(`inbox remove ${id}`, () => call(who, 'DELETE', `/inbox/${id}`))),
      ])
    }),
  )

  // Triage: assignments, one snoozed, one dismissed, in the projects that have flaky screenshots.
  for (const [who, project, assignee] of [
    ['owner', 'web-app', 'priya'],
    ['owner', 'design-system', 'amara'],
    ['daniel', 'api-server', 'tomas'],
    ['sofia', 'storybook', 'liam'],
  ] as const) {
    // eslint-disable-next-line no-await-in-loop -- one project at a time
    await tolerant(`triage in ${project}`, async () => {
      const queue = asRecord(await call(who, 'GET', `/projects/acme/${project}/triage`))
      const items = (Array.isArray(queue.items) ? queue.items : []).map(asRecord)
      const ref = (i: number) => {
        const item = items[i]
        return item ? { kind: stringIn(item, 'kind'), key: stringIn(item, 'key') } : undefined
      }
      const [first, second, third] = [ref(0), ref(1), ref(2)]
      const base = `/projects/acme/${project}/triage`
      await Promise.all([
        first
          ? call(who, 'POST', `${base}/assign`, { ...first, assigneeId: idOf(assignee, world) })
          : undefined,
        second
          ? call(who, 'POST', `${base}/snooze`, { ...second, choice: 'next_week' })
          : undefined,
        third ? call(who, 'POST', `${base}/dismiss`, third) : undefined,
      ])
    })
  }
}
