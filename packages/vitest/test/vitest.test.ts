import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { UploadOptions } from '@circi/cli'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  circiScreenshot,
  CirciReporter,
  collectDirectory,
  collectToMatchScreenshot,
  screenshotPath,
  settlePage,
  shardFromArgs,
  STABILIZE_CSS,
} from '../src/index.ts'

let root: string
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'circi-vitest-'))
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

async function touch(rel: string) {
  const path = join(root, rel)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, 'png')
}

describe('screenshotPath', () => {
  it('makes tidy, stable names that stay inside the folder', () => {
    expect(screenshotPath('Settings / Profile Page')).toBe('settings/profile-page.png')
    expect(screenshotPath('../../etc/passwd')).toBe('etc/passwd.png')
    expect(screenshotPath('Button: primary (hover)')).toBe('button-primary-hover.png')
    expect(() => screenshotPath('///')).toThrow(/usable/)
  })
})

function fakeDocument() {
  const added: { id: string; textContent: string | null }[] = []
  return {
    added,
    doc: {
      getElementById: (id: string) => added.find((a) => a.id === id) ?? null,
      createElement: () => ({ id: '', textContent: null as string | null }),
      head: {
        append: (node: { id: string; textContent: string | null }) => void added.push(node),
      },
      fonts: { ready: Promise.resolve() },
    },
  }
}

describe('settlePage and circiScreenshot', () => {
  it('turns animation off once, however often it runs', async () => {
    const { doc, added } = fakeDocument()
    await settlePage(doc)
    await settlePage(doc)
    expect(added).toHaveLength(1)
    expect(added[0]?.textContent).toBe(STABILIZE_CSS)
    expect(STABILIZE_CSS).toContain('animation: none')
  })

  it('saves the screenshot under the folder by name, after waiting for the page', async () => {
    const { doc } = fakeDocument()
    Reflect.set(globalThis, 'document', doc)
    try {
      const calls: string[] = []
      const path = await circiScreenshot(
        { screenshot: async (opts) => void calls.push(opts.path) },
        'Home / hero',
        { dir: 'shots', ready: () => void calls.push('ready') },
      )
      expect(path).toBe('shots/home/hero.png')
      expect(calls).toEqual(['ready', 'shots/home/hero.png'])
    } finally {
      Reflect.deleteProperty(globalThis, 'document')
    }
  })
})

describe('collecting screenshots', () => {
  it('names a directory’s pictures by their path', async () => {
    await touch('.circi/screenshots/home.png')
    await touch('.circi/screenshots/settings/profile.png')
    await touch('.circi/screenshots/notes.txt')
    const found = await collectDirectory(join(root, '.circi/screenshots'))
    expect(found.map((f) => f.name).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'home',
      'settings/profile',
    ])
  })

  it('adopts toMatchScreenshot references, but not its actual/diff pictures', async () => {
    await touch('src/button.test.ts/__screenshots__/button.test.ts/primary-chromium-darwin.png')
    await touch(
      'src/button.test.ts/__screenshots__/button.test.ts/primary-chromium-darwin-actual.png',
    )
    await touch(
      'src/button.test.ts/__screenshots__/button.test.ts/primary-chromium-darwin-diff.png',
    )
    await touch('node_modules/pkg/__screenshots__/x.png')
    const found = await collectToMatchScreenshot(root)
    expect(found.map((f) => f.name)).toEqual([
      'src/button.test.ts/button.test.ts/primary-chromium-darwin',
    ])
  })
})

describe('shardFromArgs', () => {
  it('reads Vitest’s 1-based --shard in both spellings', () => {
    expect(shardFromArgs(['node', 'vitest', '--shard=2/4'])).toEqual({ index: 1, total: 4 })
    expect(shardFromArgs(['vitest', '--shard', '1/3'])).toEqual({ index: 0, total: 3 })
  })
  it('ignores anything else', () => {
    expect(shardFromArgs(['vitest', 'run'])).toBeUndefined()
    expect(shardFromArgs(['--shard=5/4'])).toBeUndefined()
    expect(shardFromArgs(['--shard=0/4'])).toBeUndefined()
  })
})

describe('CirciReporter', () => {
  const result = { exitCode: 0 } as const
  const quiet = { log: () => {} }

  it('uploads what it finds as one build named for the run, with its shard', async () => {
    await touch('.circi/screenshots/a.png')
    const seen: UploadOptions[] = []
    const reporter = new CirciReporter({
      apiUrl: 'https://ci.acme.io',
      token: 'circi_x',
      name: 'vitest-chromium',
      root,
      shard: { index: 1, total: 3 },
      uploadImpl: async (o) => {
        seen.push(o)
        return result
      },
      ...quiet,
    })
    await reporter.onTestRunEnd([], [], 'passed')
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      apiUrl: 'https://ci.acme.io',
      token: 'circi_x',
      name: 'vitest-chromium',
      shard: { index: 1, total: 3 },
      wait: false,
    })
  })

  it('does nothing without credentials or without pictures, and never breaks the test run', async () => {
    let called = 0
    const upload = async () => {
      called += 1
      return result
    }
    delete process.env.CIRCI_TOKEN
    await new CirciReporter({
      apiUrl: 'https://x',
      root,
      uploadImpl: upload,
      ...quiet,
    }).onTestRunEnd([], [], 'passed')
    await new CirciReporter({
      apiUrl: 'https://x',
      token: 't',
      root,
      collectImpl: async () => [],
      uploadImpl: upload,
      ...quiet,
    }).onTestRunEnd([], [], 'passed')
    expect(called).toBe(0)

    const lines: string[] = []
    const failing = new CirciReporter({
      apiUrl: 'https://x',
      token: 't',
      root,
      uploadImpl: async () => {
        throw new Error('server down')
      },
      log: (l) => void lines.push(l),
    })
    const before = process.exitCode
    await failing.onTestRunEnd([], [], 'passed')
    expect(lines.join('\n')).toContain('server down')
    expect(process.exitCode).toBe(before)
  })
})
