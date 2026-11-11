import { generateKeyPairSync } from 'node:crypto'

import { getProjectLink } from '@circi/db/queries'
import * as schema from '@circi/db/schema'
import { createTestDb, seedProject } from '@circi/db/testing'
import { integrationRegistry } from '@circi/integrations'
import { fakeGithubInstallationsHost } from '@circi/testing/hosts'
import { Command } from 'commander'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { addAdminCommands } from '#cli/admin.ts'
import type * as RuntimeModule from '#composition/runtime.ts'

/** What the mocked runtime hands the commands: the test database. */
const world = vi.hoisted(() => ({ db: undefined as unknown }))

// As in admin.test.ts: the real runtime, with the PGlite database swapped in. GitHub is faked at
// its HTTP edge (`fetch`), so the command's own verification runs for real.
vi.mock('#composition/runtime.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof RuntimeModule>()
  return {
    ...actual,
    createRuntime: (env: Record<string, string | undefined>) => {
      const rt = actual.createRuntime(env)
      return { ...rt, db: { ...rt.db, db: world.db } }
    },
  }
})

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
  world.db = t.db
  vi.stubEnv('DATABASE_URL', 'postgres://localhost:1/unused')
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-that-is-long-enough-123')
  vi.stubEnv('PUBLIC_URL', 'https://ci.acme.io')
  vi.stubEnv('STORAGE_PATH', '/tmp/circi-github-link-unused')
  vi.stubEnv('GITHUB_APP_ID', '1')
  vi.stubEnv('GITHUB_APP_PRIVATE_KEY', privateKey)
  vi.stubEnv('GITHUB_APP_WEBHOOK_SECRET', 'whsec')
})
afterAll(async () => {
  vi.unstubAllEnvs()
  await t.close()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  process.exitCode = undefined
})

/** GitHub: installations 55 and 58 exist; 56 does not; 57 is down. */
function fakeGithub() {
  const host = fakeGithubInstallationsHost({ known: ['55', '58'], gone: ['56'] })
  host.stub()
  return host
}

async function link(org: string, project: string, installation: string): Promise<string[]> {
  const lines: string[] = []
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    lines.push(a.map(String).join(' '))
  })
  const program = new Command().exitOverride()
  addAdminCommands(program)
  await program.parseAsync(
    [
      'admin',
      'github',
      'link',
      '--org',
      org,
      '--project',
      project,
      '--repo',
      'acme/web',
      '--installation',
      installation,
    ],
    { from: 'user' },
  )
  return lines
}

describe('circi admin github link', () => {
  it('verifies the installation with GitHub, then links the project', async () => {
    const { workspace, project } = await seedProject(t.db)
    const github = fakeGithub()
    const lines = await link(workspace.slug, project.slug, '55')
    expect(github.asked()).toEqual(['55'])
    expect(lines[0]).toContain('now reports to acme/web')
    expect(await getProjectLink(t.db, project.id, integrationRegistry.gitKinds())).toEqual({
      installationId: '55',
      repoRef: 'acme/web',
    })
  })

  it("stores nothing when GitHub has no such installation, or doesn't answer", async () => {
    const { workspace, project } = await seedProject(t.db)
    fakeGithub()
    await expect(link(workspace.slug, project.slug, '56')).rejects.toThrow(/isn't installed/)
    await expect(link(workspace.slug, project.slug, '57')).rejects.toThrow(/didn't answer/)
    expect(await getProjectLink(t.db, project.id, integrationRegistry.gitKinds())).toBeUndefined()
    expect(
      (await t.db.select().from(schema.integrations)).filter((i) => i.workspaceId === workspace.id),
    ).toEqual([])
  })

  it('refuses an installation another workspace already uses', async () => {
    const mine = await seedProject(t.db)
    const theirs = await seedProject(t.db)
    fakeGithub()
    await link(theirs.workspace.slug, theirs.project.slug, '58')
    await expect(link(mine.workspace.slug, mine.project.slug, '58')).rejects.toThrow(
      /already connected to another workspace/,
    )
    expect(
      await getProjectLink(t.db, mine.project.id, integrationRegistry.gitKinds()),
    ).toBeUndefined()
  })
})
