import { ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { errorLine, UsageError } from '@circi/cli'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildStorybook, uploadStorybook } from '#src/run.ts'

let cwd = ''
beforeAll(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'circi-storybook-run-'))
  await mkdir(join(cwd, 'no-index'))
  await mkdir(join(cwd, 'empty-index'))
  await writeFile(join(cwd, 'empty-index/index.json'), '{"v":5,"entries":{}}')
})
afterAll(async () => {
  await rm(cwd, { recursive: true, force: true })
})

describe('uploadStorybook, before a browser is needed', () => {
  const quiet = { log: () => {} }

  it('stops with one actionable line when there is no built Storybook', async () => {
    const run = uploadStorybook({ cwd, staticDir: 'no-such-folder', ...quiet })
    await expect(run).rejects.toThrow(UsageError)
    await expect(run).rejects.toThrow(
      /^No built Storybook at .*no-such-folder\. Run storybook build/,
    )
  })

  it('says what is missing from a folder that is not a build, or has no stories', async () => {
    await expect(uploadStorybook({ cwd, staticDir: 'no-index', ...quiet })).rejects.toThrow(
      /no-index.* has no index\.json.*Is it the output of storybook build\?/,
    )
    await expect(uploadStorybook({ cwd, staticDir: 'empty-index', ...quiet })).rejects.toThrow(
      /has no stories/,
    )
  })

  it('refuses options that make no sense, from flags as from the config', async () => {
    await expect(uploadStorybook({ cwd, concurrency: 0, ...quiet })).rejects.toThrow(
      /concurrency must be 1 or more/,
    )
    await expect(uploadStorybook({ cwd, viewports: ['wide'], ...quiet })).rejects.toThrow(
      /must look like 1280x720/,
    )
  })
})

describe('buildStorybook', () => {
  type Spawn = NonNullable<Parameters<typeof buildStorybook>[3]>

  /** A fake `spawn`: records the call and "exits" with `code` right after. */
  function fakeSpawn(code: number) {
    const calls: { command: string; args: string[]; opts: object }[] = []
    const spawnImpl: Spawn = (command, args, opts) => {
      calls.push({ command, args, opts })
      const child = new ChildProcess()
      queueMicrotask(() => child.emit('close', code))
      return child
    }
    return { calls, spawnImpl }
  }

  it("runs the project's own storybook into the static folder, from the root", async () => {
    const { calls, spawnImpl } = fakeSpawn(0)
    const lines: string[] = []
    await buildStorybook(
      { root: '/work/app', staticDir: '/work/app/out' },
      'config',
      (l) => lines.push(l),
      spawnImpl,
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]?.args).toEqual([
      '--no-install',
      'storybook',
      'build',
      '--output-dir',
      '/work/app/out',
      '--config-dir',
      'config',
    ])
    expect(calls[0]?.opts).toMatchObject({ cwd: '/work/app' })
    expect(lines).toEqual(['[circi] storybook build → /work/app/out'])
  })

  it('fails with one line when the build does', async () => {
    const { spawnImpl } = fakeSpawn(1)
    const run = buildStorybook({ root: '/w', staticDir: '/w/o' }, undefined, () => {}, spawnImpl)
    await expect(run).rejects.toThrow('storybook build failed (exit code 1)')
    const err: unknown = await run.catch((caught: unknown) => caught)
    expect(errorLine(err)).not.toContain('\n')
  })
})
