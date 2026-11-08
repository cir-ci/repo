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

describe('UI imports', () => {
  it('keeps the web app on @circi/ui: no MUI, emotion or lucide-react in apps/web/src', () => {
    expect(importsOf('apps/web/src', [MUI, EMOTION, 'lucide-react'])).toEqual([])
  })

  it('keeps MUI out of packages/ui/src', () => {
    expect(importsOf('packages/ui/src', [MUI])).toEqual([])
  })
})
