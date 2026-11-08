import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '../../..')
const repositories = join(import.meta.dirname, '../../db/src/repositories')

/** The files that write to the job queue on behalf of others: the outbox itself. */
const OUTBOX = new Set(['jobs.ts', 'webhooks.ts', 'git.ts'])

const sourcesOf = (dir: string) =>
  readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => ({ file: join(dir, f), text: readFileSync(join(root, dir, f), 'utf8') }))

// Package scopes are assembled so this file doesn't itself match a repo-wide grep for them.
const MUI = ['@', 'mui'].join('')
const EMOTION = ['@', 'emotion'].join('')
const importsOf = (dir: string, packages: string[]) =>
  sourcesOf(dir)
    .filter((f) => packages.some((p) => new RegExp(`from '${p}(/[^']*)?'`).test(f.text)))
    .map((f) => f.file)

const named = (dir: string) =>
  readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' }).filter((f) =>
    /(github|gitlab|bitbucket|slack|linear|jira|figma)/i.test(f),
  )

describe('layers', () => {
  it('keeps repositories to storing data: only services queue jobs and notices', () => {
    const offenders = readdirSync(repositories)
      .filter((f) => f.endsWith('.ts') && !OUTBOX.has(f))
      .filter((f) =>
        /from '\.\/(jobs|webhooks|git)\.ts'/.test(readFileSync(join(repositories, f), 'utf8')),
      )
    // A repository that needs to trigger something must return what happened and let a
    // function in @circi/services do the triggering, inside its own transaction.
    expect(offenders).toEqual([])
  })
})

describe('the integration SDK', () => {
  it('keeps @circi/integrations free of the database, services and apps', () => {
    expect(
      importsOf('packages/integrations/src', ['@circi/db', '@circi/services', '@circi/worker']),
    ).toEqual([])
  })

  it('keeps the database, core and providers from importing the SDK', () => {
    expect(importsOf('packages/db/src', ['@circi/integrations'])).toEqual([])
    expect(importsOf('packages/core/src', ['@circi/integrations'])).toEqual([])
    expect(importsOf('packages/providers/src', ['@circi/integrations'])).toEqual([])
  })

  it('keeps the web app from importing definitions (it reads their public data from the API)', () => {
    expect(importsOf('apps/web/src', ['@circi/integrations'])).toEqual([])
  })

  it('has no integration route, job or page named after one integration in the generic files', () => {
    const generic = [
      'apps/server/src/http/routes/dashboard/integrations-generic.ts',
      'apps/server/src/http/routes/integration-webhook.ts',
      'packages/services/src/git-events.ts',
      'apps/web/src/features/integrations/GenericIntegrationPage.tsx',
    ]
    for (const file of generic) {
      expect(readFileSync(join(root, file), 'utf8')).not.toMatch(
        /slack|\bgithub\b|gitlab|bitbucket/i,
      )
    }
  })

  it('has no per-integration route, repository or page left: only definitions know a provider', () => {
    expect(named('apps/server/src/http/routes')).toEqual([])
    expect(named('packages/db/src/repositories')).toEqual([])
    expect(named('apps/web/src/features/integrations').filter((f) => f !== 'logos.tsx')).toEqual([])
  })
})

describe('UI imports', () => {
  it('keeps the web app on @circi/ui: no MUI, emotion or lucide-react in apps/web/src', () => {
    expect(importsOf('apps/web/src', [MUI, EMOTION, 'lucide-react'])).toEqual([])
  })

  it('keeps MUI out of packages/ui/src', () => {
    expect(importsOf('packages/ui/src', [MUI])).toEqual([])
  })
})
