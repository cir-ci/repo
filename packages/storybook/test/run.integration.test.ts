import { execFile } from 'node:child_process'
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { FakeCirci } from '@circi/testing/hosts'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

/**
 * The `circi-storybook` CLI end to end: a real Storybook 10 (React and Vite) in `fixtures/basic` is
 * built once, then the CLI (from source) screenshots its stories in headless Chromium and uploads
 * them to a fake CirCI server. Only CirCI is faked; the Storybook, the browser and the HTTP
 * between them are real. Firefox and WebKit are not run here.
 */
const run = promisify(execFile)
const PACKAGE = join(import.meta.dirname, '..')
const SOURCE_CONDITION = '--conditions=@circi/source'

let dir = ''
let storybookStatic = ''
let fake: FakeCirci

interface Outcome {
  exitCode: number
  output: string
}

/** The environment of a CI job on a branch, without anything of the surrounding run. */
function ciEnv(extra: Record<string, string> = {}): Record<string, string> {
  const base = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !/^(VITEST|CI$|CIRCI_|GITHUB_|NODE_ENV)/.test(entry[0]),
    ),
  )
  return {
    ...base,
    NO_COLOR: '1',
    CIRCI_COMMIT: 'c'.repeat(40),
    CIRCI_BRANCH: 'main',
    ...extra,
  }
}

async function cli(args: string[], env: Record<string, string> = {}): Promise<Outcome> {
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      [SOURCE_CONDITION, join(PACKAGE, 'src/main.ts'), ...args],
      { cwd: dir, env: ciEnv(env), timeout: 240_000 },
    )
    return { exitCode: 0, output: stdout + stderr }
  } catch (err) {
    const code = typeof err === 'object' && err !== null ? Reflect.get(err, 'code') : undefined
    const streams = [Reflect.get(Object(err), 'stdout'), Reflect.get(Object(err), 'stderr')]
    return {
      exitCode: typeof code === 'number' ? code : 1,
      output: streams.filter((s) => typeof s === 'string').join(''),
    }
  }
}

function first<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a request that was never made')
  return value
}

/** The `screenshots` of a finalize request: each one's name and metadata. */
function namedScreenshots(value: unknown): { name: string; metadata?: unknown }[] {
  if (!Array.isArray(value)) throw new Error('finalize has no screenshots')
  return value.map((item: unknown) => ({
    name: String(Reflect.get(Object(item), 'name')),
    metadata: Reflect.get(Object(item), 'metadata'),
  }))
}

/** Within a pixel: the crop rounds outward. */
function near(size: { width: number; height: number }, width: number, height: number) {
  expect(Math.abs(size.width - width)).toBeLessThanOrEqual(1)
  expect(Math.abs(size.height - height)).toBeLessThanOrEqual(1)
}

const toCirci = () => ({ CIRCI_API_URL: fake.url, CIRCI_TOKEN: 'circi_t' })

/** Width and height from a PNG's header. */
async function pngSize(path: string): Promise<{ width: number; height: number }> {
  const bytes = await readFile(path)
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

async function shotSize(out: string, name: string) {
  return pngSize(join(out, 'storybook', `${name}.png`))
}

async function pngNames(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true })
  return entries
    .filter((entry) => entry.endsWith('.png'))
    .map((entry) =>
      entry
        .replace(/\.png$/, '')
        .split('\\')
        .join('/'),
    )
    .toSorted()
}

beforeAll(async () => {
  dir = await mkdtemp(join(PACKAGE, 'test/fixtures/.run-'))
  await cp(join(PACKAGE, 'test/fixtures/basic'), dir, { recursive: true })
  storybookStatic = join(dir, 'storybook-static')
  await run(
    join(PACKAGE, 'node_modules/.bin/storybook'),
    ['build', '--output-dir', storybookStatic, '--disable-telemetry'],
    {
      cwd: dir,
      // The addon is listed in the fixture's main.js: Storybook loads its preset from source.
      env: ciEnv({ NODE_OPTIONS: SOURCE_CONDITION, STORYBOOK_DISABLE_TELEMETRY: '1' }),
      timeout: 240_000,
    },
  )
}, 300_000)

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

afterEach(async () => {
  await fake?.stop()
})

describe('upload', () => {
  it('screenshots every story that renders, crops to the component, and uploads them named by story', async () => {
    fake = await new FakeCirci().start()
    const out = join(dir, 'shots-main')
    const { exitCode, output } = await cli(
      ['upload', 'storybook-static', '--dir', out, '--exclude', 'Broken/**', '--no-fetch'],
      toCirci(),
    )
    expect(output).toContain('written to')
    expect(exitCode).toBe(0)

    // Every story but the skipped one, named by title and story name.
    expect(await pngNames(out)).toEqual([
      'storybook/components/badge/default',
      'storybook/components/badge/shadow',
      'storybook/components/button/primary',
      'storybook/components/button/secondary',
      'storybook/components/card/selected',
      'storybook/components/counter/clicked',
      'storybook/components/responsive/default',
      'storybook/components/responsive/phone',
      'storybook/components/responsive/tablet',
      'storybook/components/responsive/two@500x300',
      'storybook/components/responsive/two@small',
      'storybook/components/tooltip/open',
      'storybook/pages/home/default',
    ])

    // The upload: one build, the options the fixture's main.js set, the names, and the metadata.
    const create = fake.requests.find((r) => r.method === 'POST' && r.path === '/v1/builds')
    expect(fake.json(first(create))).toMatchObject({
      name: 'sb-fixture',
      commitSha: 'c'.repeat(40),
      branch: 'main',
    })
    const [finalize] = fake.to('/v1/builds/b1/finalize')
    const screenshots = namedScreenshots(fake.json(first(finalize)).screenshots)
    expect(screenshots.map((s) => s.name)).toEqual(await pngNames(join(out, 'storybook')))
    expect(screenshots.find((s) => s.name === 'components/button/primary')?.metadata).toEqual({
      storyId: 'components-button--primary',
      browser: 'chromium',
      viewport: '1280x720',
    })
    expect(screenshots.find((s) => s.name === 'components/responsive/two@small')?.metadata).toEqual(
      {
        storyId: 'components-responsive--two',
        browser: 'chromium',
        viewport: 'small',
      },
    )
    expect(fake.to('/v1/sites')).toHaveLength(0)

    // A small component in a centered story: the screenshot is its box, not the canvas around it.
    near(await shotSize(out, 'components/badge/default'), 120, 40)
    // A padded story (the default layout): the component, not the padding or the full width.
    near(await shotSize(out, 'components/button/primary'), 160, 40)
    // Its box shadow (10px blur and 6px spread: 16px a side) is part of it.
    near(await shotSize(out, 'components/badge/shadow'), 152, 72)
    // A fullscreen story: the page, at the viewport's width and the content's full height.
    near(await shotSize(out, 'pages/home/default'), 1280, 1500)
    // A portal rendered into the body is included with the story's own content: the anchor
    // starts at the padding (16px), the tooltip ends at 300 + 200 by 150 + 50.
    near(await shotSize(out, 'components/tooltip/open'), 500 - 16, 200 - 16)
    // `parameters.circi.selector` and `padding`: the 80 by 60 element and 5px around it.
    near(await shotSize(out, 'components/card/selected'), 90, 70)
    // The play function ran before the screenshot: the button grew by 30px on its click.
    near(await shotSize(out, 'components/counter/clicked'), 150, 40)
    // A story's own viewport is the screenshot's: Storybook 10's `globals.viewport` and 8's
    // `defaultViewport`, and `parameters.circi.viewports` over both.
    near(await shotSize(out, 'components/responsive/phone'), 360, 640)
    near(await shotSize(out, 'components/responsive/tablet'), 834, 1112)
    near(await shotSize(out, 'components/responsive/two@small'), 400, 300)
    near(await shotSize(out, 'components/responsive/two@500x300'), 500, 300)
    near(await shotSize(out, 'components/responsive/default'), 1280, 720)
  })

  it('reports a story that fails and one that renders nothing, runs the rest and uploads none', async () => {
    fake = await new FakeCirci().start()
    const out = join(dir, 'shots-broken')
    const { exitCode, output } = await cli(
      [
        'upload',
        'storybook-static',
        '--dir',
        out,
        '--include',
        'Broken/**,Components/Button/Primary',
        '--no-fetch',
      ],
      toCirci(),
    )
    expect(exitCode).toBe(2)
    expect(output).toContain(
      'error: broken-stories--throwing (chromium): failed: boom from the story',
    )
    expect(output).toContain('error: broken-stories--play-throws (chromium): failed: play failed')
    expect(output).toContain('error: broken-stories--empty (chromium): rendered nothing')
    expect(output).toContain('3 stories failed, so nothing was uploaded')
    // The story that works was still screenshotted.
    expect(await pngNames(out)).toEqual(['storybook/components/button/primary'])
    expect(fake.to('/v1/builds')).toHaveLength(0)
  })

  it('writes the screenshots and uploads nothing without a token, like the Vitest plugin', async () => {
    const out = join(dir, 'shots-offline')
    const { exitCode, output } = await cli([
      'upload',
      'storybook-static',
      '--dir',
      out,
      '--include',
      'Components/Button/Primary',
    ])
    expect(exitCode).toBe(0)
    expect(output).toContain('[circi] skipped: set CIRCI_API_URL and CIRCI_TOKEN')
    expect(await pngNames(out)).toEqual(['storybook/components/button/primary'])
  })

  it('names screenshots by browser and viewport once more than one is configured, and uploads the site', async () => {
    fake = await new FakeCirci().start()
    const out = join(dir, 'shots-viewports')
    const { exitCode } = await cli(
      [
        'upload',
        'storybook-static',
        '--dir',
        out,
        '--include',
        'Components/Button/Primary',
        '--viewport',
        '400x300,mobile=500x300',
        '--site',
        '--name',
        'sb-cli',
        '--wait',
        '--no-fetch',
      ],
      toCirci(),
    )
    expect(exitCode).toBe(0)
    expect(await pngNames(out)).toEqual([
      'storybook/components/button/primary@400x300',
      'storybook/components/button/primary@mobile',
    ])
    const [finalize] = fake.to('/v1/builds/b1/finalize')
    expect(fake.json(first(finalize)).screenshots).toMatchObject([
      { name: 'components/button/primary@400x300', metadata: { viewport: '400x300' } },
      { name: 'components/button/primary@mobile', metadata: { viewport: 'mobile' } },
    ])
    // The flag overrode the name from the config; `--wait` asked for the result.
    const create = fake.requests.find((r) => r.method === 'POST' && r.path === '/v1/builds')
    expect(fake.json(first(create)).name).toBe('sb-cli')
    expect(fake.to('/v1/builds/b1/status')).toHaveLength(1)
    // The built Storybook, as a hosted site of kind storybook.
    const [site] = fake.to('/v1/sites?')
    expect(Object.fromEntries(new URL(`http://x${site?.path}`).searchParams)).toMatchObject({
      name: 'storybook',
      kind: 'storybook',
    })
  })
})
