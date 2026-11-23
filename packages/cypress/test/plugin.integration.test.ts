import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { FakeCirci } from '@circi/testing/hosts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * `circi()` and `@circi/cypress/support` against real Cypress (headless Electron), as published:
 * the project in `fixtures/basic` imports the built package, uses plain `cy.screenshot()`, and
 * uploads to a fake CirCI server. What is proven: the screenshots Cypress took, how they are named
 * and cropped, the files and sidecars left on disk, and what reached the (fake) server. CirCI's
 * own handling of the upload is not part of it.
 */
const run = promisify(execFile)
const PACKAGE = join(import.meta.dirname, '..')
const CYPRESS_BIN = join(PACKAGE, 'node_modules/cypress/bin/cypress')
// The fixture's page: 800 CSS pixels wide, content 200 tall (a card 200 by 100 below an 80 tall header).
const VIEWPORT = { width: 800, height: 600 }
const CONTENT_HEIGHT = 200

/** Width and height of a PNG, from its header. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

function outputOf(err: unknown): string {
  if (typeof err !== 'object' || err === null) return String(err)
  return [Reflect.get(err, 'stdout'), Reflect.get(err, 'stderr')]
    .filter((s) => typeof s === 'string')
    .join('')
}

interface Outcome {
  code: number
  output: string
}

/** The fixture project's own copy, so runs never share a screenshots folder. */
function useFixture() {
  let dir = ''
  beforeAll(async () => {
    dir = await mkdtemp(join(PACKAGE, 'test/fixtures/.run-'))
    await cp(join(PACKAGE, 'test/fixtures/basic'), dir, { recursive: true })
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  return {
    dir: () => dir,
    async cypress(
      spec: string,
      env: Record<string, string> = {},
      testingType: 'e2e' | 'component' = 'e2e',
    ): Promise<Outcome> {
      // Not the surrounding test run's own state (a nested Vitest or CI environment).
      const base = Object.fromEntries(
        Object.entries(process.env).filter(
          ([k]) => !/^(VITEST|CI$|CIRCI_|CYPRESS_|NODE_ENV|GITHUB_|GITLAB_|CIRCLE)/.test(k),
        ),
      )
      try {
        const { stdout, stderr } = await run(
          process.execPath,
          [CYPRESS_BIN, 'run', `--${testingType}`, '--browser', 'electron', '--spec', spec],
          { cwd: dir, env: { ...base, NO_COLOR: '1', ...env }, timeout: 280_000 },
        )
        return { code: 0, output: stdout + stderr }
      } catch (err) {
        const code = typeof err === 'object' && err !== null ? Reflect.get(err, 'code') : undefined
        return { code: typeof code === 'number' ? code : 1, output: outputOf(err) }
      }
    },
    async list(sub: string): Promise<string[]> {
      const entries = await readdir(join(dir, sub), { recursive: true, withFileTypes: true }).catch(
        () => [],
      )
      return entries
        .filter((e) => e.isFile())
        .map((e) => join(e.parentPath, e.name).slice(join(dir, sub).length + 1))
        .toSorted()
    },
    read: (rel: string) => readFile(join(dir, rel)),
  }
}

/** The environment that says where to upload, and which commit, as a CI does. */
function ciEnv(fake: FakeCirci): Record<string, string> {
  return {
    CIRCI_API_URL: fake.url,
    CIRCI_TOKEN: 'circi_test',
    GITLAB_CI: 'true',
    CI_COMMIT_SHA: 'a'.repeat(40),
    CI_COMMIT_BRANCH: 'feature',
  }
}

/** The screenshots the finalize request lists: what the build holds, by name. */
function screenshotsOf(fake: FakeCirci): { name: string; metadata?: unknown }[] {
  const body = fake.json('POST', '/v1/builds/b1/finalize')
  const list: unknown = body?.screenshots
  if (!Array.isArray(list)) return []
  return list.flatMap((s: unknown) =>
    typeof s === 'object' && s !== null && 'name' in s && typeof s.name === 'string'
      ? [{ name: s.name, metadata: 'metadata' in s ? s.metadata : undefined }]
      : [],
  )
}

// A real Cypress run starts Electron; slow on a loaded machine.
const RUN_TIMEOUT = 300_000
// This plugin's own folder under the shared one: `<dir>/cypress/<spec path from the project root>/<name>`.
const TOOL = '.circi/screenshots/cypress'
const SPEC = 'cypress/e2e/shots.cy.js'
const SHOTS = [
  'cypress/e2e/admin/home.cy.js/hero.png',
  'cypress/e2e/admin/home.cy.js/hero.png.json',
  'cypress/e2e/public/home.cy.js/hero.png',
  'cypress/e2e/public/home.cy.js/hero.png.json',
  `${SPEC}/home.png`,
  `${SPEC}/home.png.json`,
  `${SPEC}/padded.png`,
  `${SPEC}/padded.png.json`,
  `${SPEC}/parts/card.png`,
  `${SPEC}/parts/card.png.json`,
  `${SPEC}/tall.png`,
  `${SPEC}/tall.png.json`,
]

describe('circi() with real Cypress', () => {
  const fixture = useFixture()
  const fake = new FakeCirci({ outcome: 'fail' })
  let outcome: Outcome
  let ratio = 1

  beforeAll(async () => {
    await fake.start()
    // `wait` with a build that needs review: the run's own exit code carries it.
    // Another tool's folder under the same `dir`: neither emptied nor uploaded.
    await mkdir(join(fixture.dir(), '.circi/screenshots/vitest'), { recursive: true })
    await writeFile(join(fixture.dir(), '.circi/screenshots/vitest/other.png'), 'x')
    outcome = await fixture.cypress(
      [SPEC, 'cypress/e2e/admin/home.cy.js', 'cypress/e2e/public/home.cy.js'].join(','),
      {
        ...ciEnv(fake),
        FIXTURE_WAIT: '1',
      },
    )
    const home = await fixture.read(`${TOOL}/${SPEC}/home.png`).catch(() => undefined)
    // The display's pixel ratio: a Retina machine takes 2x images.
    if (home) ratio = pngSize(home).width / VIEWPORT.width
  }, RUN_TIMEOUT)
  afterAll(() => fake.stop())

  it(
    'leaves the named screenshots, by spec file and name, with sidecars',
    { timeout: RUN_TIMEOUT },
    async () => {
      // Unnamed ones (and failure screenshots) are not part of the review.
      expect(await fixture.list(TOOL)).toEqual(SHOTS)
      const sidecar = JSON.parse(
        (await fixture.read(`${TOOL}/${SPEC}/home.png.json`)).toString('utf8'),
      )
      expect(sidecar).toEqual({ spec: SPEC, browser: 'electron', viewport: '800x600' })
    },
  )

  it('crops an element to its own box, and to nothing more', async () => {
    const card = pngSize(await fixture.read(`${TOOL}/${SPEC}/parts/card.png`))
    expect(card).toEqual({ width: 200 * ratio, height: 100 * ratio })
  })

  it('adds the padding asked for, on purpose', async () => {
    const padded = pngSize(await fixture.read(`${TOOL}/${SPEC}/padded.png`))
    expect(padded).toEqual({ width: 220 * ratio, height: 120 * ratio })
  })

  it('takes a short page at the height of its content, not of the viewport', async () => {
    const home = pngSize(await fixture.read(`${TOOL}/${SPEC}/home.png`))
    expect(home).toEqual({ width: VIEWPORT.width * ratio, height: CONTENT_HEIGHT * ratio })
  })

  it('clamps padding on a long page to the end of the document', async () => {
    const tall = pngSize(await fixture.read(`${TOOL}/${SPEC}/tall.png`))
    // 5000px of padding asked for; the page is 1500px tall.
    // A page that scrolls has a scrollbar, which takes some of the width.
    expect(tall.height).toBe(1500 * ratio)
    expect(tall.width).toBeGreaterThan((VIEWPORT.width - 30) * ratio)
    expect(tall.width).toBeLessThanOrEqual(VIEWPORT.width * ratio)
  })

  it('names screenshots by the spec path, so two specs with one file name stay apart', async () => {
    const admin = pngSize(await fixture.read(`${TOOL}/cypress/e2e/admin/home.cy.js/hero.png`))
    const publicHero = pngSize(await fixture.read(`${TOOL}/cypress/e2e/public/home.cy.js/hero.png`))
    expect(admin).toEqual({ width: VIEWPORT.width * ratio, height: 80 * ratio })
    expect(publicHero).toEqual({ width: 200 * ratio, height: 100 * ratio })
  })

  it("leaves another tool's folder alone: not emptied, not uploaded", async () => {
    expect(await fixture.list('.circi/screenshots/vitest')).toEqual(['other.png'])
    expect(screenshotsOf(fake).some((f) => f.name.includes('other'))).toBe(false)
  })

  it('skips a screenshot named with nothing usable, with a notice and without failing the test', () => {
    expect(outcome.output).toContain('[circi] skipped screenshot "!!"')
  })

  it('fails the run (non-zero exit) with wait while changes need review', () => {
    // The spec itself passes: only the throw in after:run can make the exit code non-zero.
    expect(outcome.output).toMatch(/Passing:\s+5\b/)
    expect(outcome.output).not.toMatch(/Failing:\s+[1-9]/)
    expect(outcome.output).toContain('Changes found')
    expect(outcome.code).not.toBe(0)
  })

  it('refuses an element with nothing to show instead of saving a blank image', () => {
    // The spec asserts the error itself; the run passing means the test saw "nothing to capture".
    expect(outcome.output).toContain('refuses an element that has nothing to show')
    expect(outcome.output).not.toMatch(/hidden\.png/)
  })

  it('uploaded the screenshots in one build, named like @circi/vitest names them', () => {
    expect(fake.json('POST', '/v1/builds')).toMatchObject({
      name: 'cypress-fixture',
      commitSha: 'a'.repeat(40),
    })
    const files = screenshotsOf(fake)
    // Named relative to the tool's folder, so the tool's name isn't in them.
    expect(files.map((f) => f.name).toSorted()).toEqual([
      'cypress/e2e/admin/home.cy.js/hero',
      'cypress/e2e/public/home.cy.js/hero',
      `${SPEC}/home`,
      `${SPEC}/padded`,
      `${SPEC}/parts/card`,
      `${SPEC}/tall`,
    ])
    // Their sidecar's metadata travels with them.
    expect(files[0]).toMatchObject({
      metadata: { browser: 'electron', viewport: '800x600' },
    })
    // The fake already has the first file of a build with several, and the public hero is the same picture as the card,
    // so four distinct files are sent.
    expect(fake.uploads()).toHaveLength(4)
  })
})

describe('circi() when a test fails', () => {
  const fixture = useFixture()
  const fake = new FakeCirci()
  let outcome: Outcome

  beforeAll(async () => {
    await fake.start()
    outcome = await fixture.cypress('cypress/e2e/failing.cy.js', ciEnv(fake))
  }, RUN_TIMEOUT)
  afterAll(() => fake.stop())

  it(
    "uploads the test's named screenshot but not Cypress's automatic failure screenshot",
    { timeout: RUN_TIMEOUT },
    async () => {
      expect(outcome.code).not.toBe(0)
      // Cypress did take its own failure screenshot...
      expect(await fixture.list('cypress/screenshots')).toContain(
        'failing.cy.js/failing -- fails, and Cypress takes its own screenshot (failed).png',
      )
      // ...and only the named one is in the build.
      expect(await fixture.list(TOOL)).toEqual([
        'cypress/e2e/failing.cy.js/before-failure.png',
        'cypress/e2e/failing.cy.js/before-failure.png.json',
      ])
      expect(screenshotsOf(fake).map((f) => f.name)).toEqual([
        'cypress/e2e/failing.cy.js/before-failure',
      ])
    },
  )
})

describe('circi() in component testing', () => {
  const fixture = useFixture()
  let outcome: Outcome

  beforeAll(async () => {
    outcome = await fixture.cypress('cypress/component/button.cy.js', {}, 'component')
  }, RUN_TIMEOUT)

  it(
    'takes the mounted component at its own box, not the viewport',
    { timeout: RUN_TIMEOUT },
    async () => {
      expect({ code: outcome.code, tail: outcome.output.slice(-1500) }).toMatchObject({ code: 0 })
      expect(await fixture.list(TOOL)).toEqual([
        'cypress/component/button.cy.js/button/primary.png',
        'cypress/component/button.cy.js/button/primary.png.json',
      ])
      const button = pngSize(
        await fixture.read(`${TOOL}/cypress/component/button.cy.js/button/primary.png`),
      )
      // The button is 120 by 40 with a 30px margin: the margin is outside its box.
      const ratio = button.width / 120
      expect(button).toEqual({ width: 120 * ratio, height: 40 * ratio })
      expect(ratio).toBeGreaterThanOrEqual(1)
    },
  )
})
