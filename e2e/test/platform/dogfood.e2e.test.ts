import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { Build } from '@circi/api'
import { describe, expect, it } from 'vitest'

import { approveBuild, createTeam, type CreatedTeam } from '#clients/admin.ts'
import { GIT_ENV } from '#github/git-repo.ts'
import { REPO_ROOT } from '#stack/paths.ts'
import { useStack } from '#stack/vitest.ts'

/**
 * CirCI tests its own design system. `pnpm test:visual` screenshots every `@circi/ui` component in
 * both colour schemes in Vitest browser mode and uploads them through `@circi/vitest`; here that
 * runs as a child process against the real stack, the way a CI job would. Run twice on the same
 * commit, the second build must find nothing changed: a screenshot that differs between two runs
 * of unchanged code is flakiness in the suite, and is fixed there (animations, fonts, time).
 */
const SCREENSHOTS = join(REPO_ROOT, '.circi', 'screenshots')
// Unrelated to this checkout's real history: the build is about the screenshots, not the commit.
const COMMIT = 'd0f00d'.repeat(6) + 'd0f0'

async function countScreenshots(dir: string): Promise<number> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  return entries.filter((e) => e.isFile() && e.name.endsWith('.png')).length
}

/** `pnpm test:visual` with the CirCI environment pointed at the stack, as CI would run it. */
function runVisualSuite(options: {
  apiUrl: string
  token: string
}): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    const env: Record<string, string> = {}
    for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG']) {
      const value = process.env[key]
      if (value) env[key] = value
    }
    const child = spawn('pnpm', ['test:visual'], {
      cwd: REPO_ROOT,
      env: {
        ...env,
        ...GIT_ENV,
        CIRCI_API_URL: options.apiUrl,
        CIRCI_TOKEN: options.token,
        CIRCI_COMMIT: COMMIT,
        CIRCI_BRANCH: 'main',
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (c) => (output += String(c)))
    child.stderr.on('data', (c) => (output += String(c)))
    child.on('error', reject)
    child.on('close', (code) => resolve({ exitCode: code ?? 1, output }))
  })
}

describe('the design system tests itself with @circi/vitest', () => {
  const ctx = useStack({ profile: 'default', setup: true })
  let team: CreatedTeam
  let expected = 0

  const workspace = () => ctx.setup.workspace.slug
  const detail = (n: number) =>
    ctx.setup.session.get<Build.Detail>(`/api/teams/${workspace()}/${team.slug}/builds/${n}`)

  it(
    'the first run uploads every screenshot as added, waiting for review',
    { timeout: 300_000 },
    async () => {
      const { stack, setup } = ctx
      team = await createTeam(setup.session, workspace(), 'Design system')

      const run = await runVisualSuite({ apiUrl: stack.url, token: team.token })
      // `wait: true` in the reporter: the run fails while the build needs review.
      expect({ exitCode: run.exitCode, tail: run.output.slice(-3000) }).toMatchObject({
        exitCode: 1,
      })
      expect(run.output).toMatch(/Test Files\s+1 passed/)

      expected = await countScreenshots(SCREENSHOTS)
      // Every component in both schemes: far more than a handful.
      expect(expected).toBeGreaterThan(80)

      const { builds } = await setup.session.get<{ builds: Build.ListItem[] }>(
        `/api/teams/${workspace()}/${team.slug}`,
      )
      expect(builds).toHaveLength(1)
      const first = await detail(builds[0]?.number ?? 0)
      expect(first.build).toMatchObject({
        name: 'ui-chromium',
        status: 'complete',
        reviewStatus: 'pending',
        branch: 'main',
      })
      expect(first.diffs).toHaveLength(expected)
      expect(new Set(first.diffs.map((d) => d.status))).toEqual(new Set(['added']))
      // Named by component, case and scheme.
      const names = first.diffs.map((d) => d.name)
      expect(names).toContain('button/variants/light')
      expect(names).toContain('button/variants/dark')
      expect(names.filter((n) => n.endsWith('/light')).length).toBeGreaterThan(40)
      expect(names.filter((n) => n.endsWith('/dark')).length).toBeGreaterThan(40)
    },
  )

  it(
    'after approval, a second run of unchanged code finds no change at all',
    { timeout: 300_000 },
    async () => {
      const { stack, setup } = ctx
      await approveBuild(setup.session, workspace(), team.slug, 1)

      const run = await runVisualSuite({ apiUrl: stack.url, token: team.token })
      expect({ exitCode: run.exitCode, tail: run.output.slice(-3000) }).toMatchObject({
        exitCode: 0,
      })

      const second = await detail(2)
      const changed = second.diffs.filter((d) => d.status !== 'unchanged').map((d) => d.name)
      // A name here is a flaky screenshot: fix its source in packages/ui/visual or @circi/vitest.
      expect(changed).toEqual([])
      expect(second.diffs).toHaveLength(expected)
      expect(second.build).toMatchObject({ conclusion: 'no_changes', status: 'complete' })
    },
  )
})
