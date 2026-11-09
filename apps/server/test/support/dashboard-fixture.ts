import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addMember as addWorkspaceMember, createUser } from '@circi/auth'
import { createBuild, markFileVerified, planUploads } from '@circi/db'
import { finalizeBuild, reviewBuild } from '@circi/services'
import { contentKey, FsStorage } from '@circi/storage'
import { createTestDb } from '@circi/testing'
import { processBuild } from '@circi/worker'
import { pino } from 'pino'
import sharp from 'sharp'

import { buildServer } from '#http/app.ts'

import { clientFor, signedInClient, type Client } from './client.ts'
import { snapshotDb } from './db-snapshot.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn } from './helpers.ts'

const logger = pino({ level: 'silent' })
export const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

export async function png(color: string): Promise<Buffer> {
  return sharp({ create: { width: 60, height: 40, channels: 4, background: color } })
    .png()
    .toBuffer()
}

/**
 * The dashboard server the dashboard route tests share: two unrelated workspaces (`acme` has
 * two builds, `rival` is someone else), both signed in, over a real PGlite database and local
 * file storage.
 */
export async function startDashboard() {
  const t = await createTestDb()
  const betterAuth = createTestAuth(t.db)
  const dir = await mkdtemp(join(tmpdir(), 'circi-dash-'))
  const storage = new FsStorage({ path: join(dir, 'files') })
  const webDist = join(dir, 'web')
  await mkdir(join(webDist, 'assets'), { recursive: true })
  await writeFile(join(webDist, 'index.html'), '<!doctype html><div id="root"></div>')
  await writeFile(join(webDist, 'assets', 'app-1a2b3c.js'), 'console.log(1)')
  const app = buildServer({
    logger,
    checks: [],
    dashboard: { db: t.db, auth: betterAuth, storage, publicOrigin: ORIGIN, webDist },
  })
  await app.ready()

  const acme = await seedTenant(betterAuth, t.db)
  const rival = await seedTenant(betterAuth, t.db)
  const acmeCookie = await signIn(app, acme.owner.email, acme.owner.password)
  const rivalCookie = await signIn(app, rival.owner.email, rival.owner.password)

  async function buildWith(
    teamId: string,
    commitSha: string,
    ancestors: string[],
    shots: Record<string, Buffer>,
  ) {
    const b = await createBuild(t.db, {
      teamId,
      commitSha,
      branch: 'main',
      ancestorShas: ancestors,
    })
    const planned = await planUploads(t.db, {
      buildId: b.id,
      kind: 'screenshot',
      files: Object.values(shots).map((v) => ({
        sha256: sha(v),
        size: v.length,
        contentType: 'image/png',
      })),
      storageKeyFor: (s) => contentKey(s),
    })
    await Promise.all(
      planned.map(async (p) => {
        const bytes = Object.values(shots).find((v) => sha(v) === p.sha256) ?? Buffer.alloc(0)
        await storage.put(p.storageKey, bytes)
        await markFileVerified(t.db, p.sha256, { size: bytes.length })
      }),
    )
    await finalizeBuild(t.db, {
      buildId: b.id,
      screenshots: Object.entries(shots).map(([name, v]) => ({ name, sha256: sha(v) })),
    })
    await processBuild({ db: t.db, storage }, b.id)
    return b
  }

  // A team's first build has no baseline, so it waits for review: someone approves it once.
  // Build 2 then has that baseline, and on the default branch it is approved automatically.
  const first = await buildWith(acme.team.id, 'aaaa001', [], {
    home: await png('#ffffff'),
    about: await png('#eeeeee'),
  })
  await reviewBuild(t.db, { buildId: first.id, userId: acme.owner.id, state: 'approved' })
  await buildWith(acme.team.id, 'aaaa002', ['aaaa001'], {
    home: await png('#ff0000'),
    about: await png('#eeeeee'),
  })

  /** GET as Acme's owner by default; pass '' for no session at all. */
  const get = (url: string, cookie: string = acmeCookie) =>
    app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} })

  async function buildDetail(cookie: string, workspaceSlug = acme.workspaceSlug) {
    return get(`/api/teams/${workspaceSlug}/web/builds/2`, cookie)
  }

  const review = (
    state: unknown,
    options: {
      cookie?: string
      origin?: string | null
      workspace?: string
      build?: number
      headers?: Record<string, string>
    } = {},
  ) =>
    app.inject({
      method: 'POST',
      url: `/api/teams/${options.workspace ?? acme.workspaceSlug}/web/builds/${options.build ?? 2}/review`,
      headers: {
        'content-type': 'application/json',
        ...(options.cookie === '' ? {} : { cookie: options.cookie ?? acmeCookie }),
        ...(options.origin === null ? {} : { origin: options.origin ?? ORIGIN }),
        ...options.headers,
      },
      payload: { state },
    })

  let people = 0
  /**
   * A new signed-in account for Acme's workspace: `member`, `admin` or `owner` joins it with that
   * role; `outsider` belongs to no workspace at all.
   */
  async function addMember(role: 'owner' | 'admin' | 'member' | 'outsider'): Promise<Client> {
    people += 1
    const who = { email: `${role}${people}@acme.test`, password: `${role}-password-${people}-long` }
    await createUser(betterAuth, { ...who, name: `${role} ${people}` })
    if (role !== 'outsider') {
      await addWorkspaceMember(betterAuth, t.db, {
        workspaceSlug: acme.workspaceSlug,
        email: who.email,
        role,
      })
    }
    return signedInClient(app, who)
  }

  return {
    app,
    db: t.db,
    /** Acme's owner and Rival's owner, as clients. */
    client: clientFor(app, acmeCookie),
    rivalClient: clientFor(app, rivalCookie),
    addMember,
    auth: betterAuth,
    acme,
    rival,
    acmeCookie,
    rivalCookie,
    buildWith,
    /**
     * Remembers the database as it is now (call it after the file's own setup) and returns the
     * function that puts it back: `const reset = await fx.snapshot(); beforeEach(reset)`.
     */
    snapshot: () => snapshotDb(t),
    get,
    buildDetail,
    review,
    async close() {
      await app.close()
      await t.close()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

export type DashboardFixture = Awaited<ReturnType<typeof startDashboard>>
