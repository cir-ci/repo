import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createUser } from '@circi/auth'
import { createTestDb } from '@circi/db/testing'
import { FsStorage } from '@circi/storage'
import { pino } from 'pino'

import { buildServer } from '#http/app.ts'

import { snapshotDb } from './db-snapshot.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn, addMember } from './helpers.ts'

/**
 * A dashboard server with no builds: Acme (an owner and one plain member) and an unrelated
 * Rival, all signed in. For the project and workspace page routes, whose tests seed what they need.
 */
export async function startPages() {
  const t = await createTestDb()
  const auth = createTestAuth(t.db)
  const dir = await mkdtemp(join(tmpdir(), 'circi-pages-'))
  const app = buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    dashboard: {
      db: t.db,
      auth,
      storage: new FsStorage({ path: join(dir, 'files') }),
      publicOrigin: ORIGIN,
    },
  })
  await app.ready()
  const acme = await seedTenant(auth, t.db)
  const rival = await seedTenant(auth, t.db)
  const plain = await createUser(auth, {
    email: 'plain@pages.test',
    name: 'Plain',
    password: 'plain-password-long-1',
  })
  await addMember(auth, t.db, {
    workspaceSlug: acme.workspaceSlug,
    email: plain.email,
    role: 'member',
  })
  return {
    app,
    t,
    auth,
    acme,
    rival,
    ownerCookie: await signIn(app, acme.owner.email, acme.owner.password),
    memberCookie: await signIn(app, plain.email, 'plain-password-long-1'),
    rivalCookie: await signIn(app, rival.owner.email, rival.owner.password),
    /** Remembers the database as it is now and returns the function that restores it (use in `beforeEach`). */
    snapshot: () => snapshotDb(t),
    async close() {
      await app.close()
      await t.close()
      await rm(dir, { recursive: true, force: true })
    },
  }
}
