import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { circi } from '#src/plugin.ts'

import { useTempRoot } from './support/temp-root.ts'

type Handler = (arg: never) => unknown

/** A stand-in for Cypress's `on`: keeps the handlers, so a test can fire the events itself. */
function fakeCypress() {
  const handlers = new Map<string, Handler>()
  function on(event: string, handler: Handler): void {
    handlers.set(event, handler)
  }
  return {
    // Cypress's `on` is typed per event; this one accepts the three the plugin registers.
    on: on as Parameters<ReturnType<typeof circi>>[0],
    fire: async (event: string, arg: unknown): Promise<unknown> => {
      const handler = handlers.get(event)
      if (!handler) throw new Error(`no handler for ${event}`)
      // The test passes what Cypress would.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return handler(arg as never)
    },
    registered: () => [...handlers.keys()].toSorted(),
  }
}

const failing: circi.Options['uploadImpl'] = () => Promise.reject(new Error('503 from CirCI'))

describe('circi()', () => {
  const temp = useTempRoot()

  function setup(options: circi.Options = {}) {
    const cypress = fakeCypress()
    const lines: string[] = []
    const uploads: Parameters<NonNullable<circi.Options['uploadImpl']>>[0][] = []
    const config = { projectRoot: temp.root() }
    const returned = circi({
      env: { CIRCI_API_URL: 'https://circi.test', CIRCI_TOKEN: 'circi_t' },
      log: (l) => void lines.push(l),
      uploadImpl: (o) => {
        uploads.push(o)
        return Promise.resolve({ exitCode: 0 })
      },
      ...options,
    })(cypress.on, config)
    return { cypress, lines, uploads, config, returned }
  }

  async function screenshot(
    cypress: ReturnType<typeof fakeCypress>,
    details: Record<string, unknown>,
  ) {
    const path = await temp.cypressWrote(`raw-${Math.random()}.png`, String(details.name))
    return cypress.fire('after:screenshot', {
      path,
      specName: 'home.cy.ts',
      testFailure: false,
      ...details,
    })
  }

  it('registers the three events, and hands the config back for setupNodeEvents', () => {
    const { cypress, returned, config } = setup()
    expect(cypress.registered()).toEqual(['after:run', 'after:screenshot', 'before:run'])
    expect(returned).toBe(config)
  })

  it('copies a named screenshot to <dir>/<spec>/<name>.png with a sidecar', async () => {
    const { cypress } = setup()
    await cypress.fire('before:run', { browser: { name: 'chrome' } })
    const result = await screenshot(cypress, { name: 'button/primary' })
    // Nothing is renamed or moved for Cypress.
    expect(result).toEqual({})
    const file = join(temp.root(), '.circi/screenshots/home.cy.ts/button/primary.png')
    expect(await readFile(file, 'utf8')).toBe('button/primary')
    expect(JSON.parse(await readFile(`${file}.json`, 'utf8'))).toEqual({
      spec: 'home.cy.ts',
      browser: 'chrome',
    })
  })

  it("takes the viewport from the screenshot's details, or else from the config", async () => {
    const { cypress } = setup()
    await screenshot(cypress, { name: 'a', viewport: { width: 1, height: 2 } })
    const first = join(temp.root(), '.circi/screenshots/home.cy.ts/a.png.json')
    expect(JSON.parse(await readFile(first, 'utf8')).viewport).toBe('1x2')

    const withConfig = fakeCypress()
    circi({ root: temp.root() })(withConfig.on, {
      projectRoot: temp.root(),
      viewportWidth: 1000,
      viewportHeight: 660,
    })
    await screenshot(withConfig, { name: 'b' })
    const second = join(temp.root(), '.circi/screenshots/home.cy.ts/b.png.json')
    expect(JSON.parse(await readFile(second, 'utf8')).viewport).toBe('1000x660')
  })

  it("skips Cypress's automatic failure screenshot and unnamed ones", async () => {
    const { cypress } = setup()
    await screenshot(cypress, { name: 'home (failed)', testFailure: true })
    await screenshot(cypress, { name: null })
    await screenshot(cypress, { name: undefined })
    expect(existsSync(join(temp.root(), '.circi'))).toBe(false)
  })

  it('keeps the last when a name is taken twice, as a retried test does', async () => {
    const { cypress } = setup()
    const path = await temp.cypressWrote('one.png', 'first')
    await cypress.fire('after:screenshot', { path, specName: 'a.cy.ts', name: 'x' })
    await writeFile(path, 'second')
    await cypress.fire('after:screenshot', { path, specName: 'a.cy.ts', name: 'x' })
    const file = join(temp.root(), '.circi/screenshots/a.cy.ts/x.png')
    expect(await readFile(file, 'utf8')).toBe('second')
  })

  it('empties the folder when a run starts, unless told not to', async () => {
    const kept = join(temp.root(), '.circi/screenshots/old.cy.ts')
    await mkdir(kept, { recursive: true })
    await writeFile(join(kept, 'old.png'), 'x')
    await setup().cypress.fire('before:run', {})
    expect(existsSync(join(kept, 'old.png'))).toBe(false)

    await mkdir(kept, { recursive: true })
    await writeFile(join(kept, 'old.png'), 'x')
    await setup({ clean: false }).cypress.fire('before:run', {})
    expect(existsSync(join(kept, 'old.png'))).toBe(true)
  })

  describe('when the run ends', () => {
    it('uploads the folder as one build named cypress, with the CI settings', async () => {
      const { cypress, uploads } = setup()
      await screenshot(cypress, { name: 'a' })
      await cypress.fire('after:run', { runs: [] })
      expect(uploads).toHaveLength(1)
      expect(uploads[0]).toMatchObject({
        dir: join(temp.root(), '.circi/screenshots'),
        apiUrl: 'https://circi.test',
        token: 'circi_t',
        name: 'cypress',
        wait: false,
      })
      expect(uploads[0]).not.toHaveProperty('shard')
    })

    it('uses the options over the environment, and a custom folder and name', async () => {
      const { cypress, uploads } = setup({
        apiUrl: 'https://other.test',
        token: 'circi_o',
        name: 'cypress-firefox',
        dir: 'shots',
      })
      await screenshot(cypress, { name: 'a' })
      await cypress.fire('after:run', { runs: [] })
      expect(uploads[0]).toMatchObject({
        dir: join(temp.root(), 'shots'),
        apiUrl: 'https://other.test',
        token: 'circi_o',
        name: 'cypress-firefox',
      })
      expect(existsSync(join(temp.root(), 'shots/home.cy.ts/a.png'))).toBe(true)
    })

    it('reads the shard from CIRCI_SHARD (1-based), or from the options', async () => {
      const fromEnv = setup({
        env: { CIRCI_API_URL: 'https://circi.test', CIRCI_TOKEN: 't', CIRCI_SHARD: '2/4' },
      })
      await screenshot(fromEnv.cypress, { name: 'a' })
      await fromEnv.cypress.fire('after:run', { runs: [] })
      expect(fromEnv.uploads[0]).toMatchObject({ shard: { index: 1, total: 4 } })

      const fromOption = setup({ shard: { index: 0, total: 3 } })
      await screenshot(fromOption.cypress, { name: 'a' })
      await fromOption.cypress.fire('after:run', { runs: [] })
      expect(fromOption.uploads[0]).toMatchObject({ shard: { index: 0, total: 3 } })
    })

    it('skips with a warning, and does not fail, when there is no token', async () => {
      const { cypress, lines, uploads } = setup({ env: {} })
      await screenshot(cypress, { name: 'a' })
      await expect(cypress.fire('after:run', { runs: [] })).resolves.toBeUndefined()
      expect(lines).toEqual([
        '[circi] skipped: set CIRCI_API_URL and CIRCI_TOKEN to upload screenshots',
      ])
      expect(uploads).toEqual([])
    })

    it('says so, and uploads nothing, when no screenshot was taken', async () => {
      const { cypress, lines, uploads } = setup()
      await cypress.fire('after:run', { runs: [] })
      expect(lines).toEqual(['[circi] no screenshots found, nothing to upload'])
      expect(uploads).toEqual([])
    })

    it('does nothing when Cypress could not run at all', async () => {
      const { cypress, lines, uploads } = setup()
      await screenshot(cypress, { name: 'a' })
      await cypress.fire('after:run', { status: 'failed', failures: 1, message: 'no specs' })
      expect(lines).toEqual([])
      expect(uploads).toEqual([])
    })

    it('logs a failed upload and leaves the run alone, unless strict', async () => {
      const lenient = setup({ uploadImpl: failing })
      await screenshot(lenient.cypress, { name: 'a' })
      await expect(lenient.cypress.fire('after:run', { runs: [] })).resolves.toBeUndefined()
      expect(lenient.lines.join('\n')).toContain('[circi] upload failed: 503 from CirCI')

      const strict = setup({ uploadImpl: failing, strict: true })
      await screenshot(strict.cypress, { name: 'a' })
      await expect(strict.cypress.fire('after:run', { runs: [] })).rejects.toThrow(
        '[circi] exit code 1',
      )
    })

    it('with wait, fails the run when the upload says changes need review', async () => {
      const waiting = setup({
        wait: true,
        uploadImpl: () => Promise.resolve({ exitCode: 1 }),
      })
      await screenshot(waiting.cypress, { name: 'a' })
      await expect(waiting.cypress.fire('after:run', { runs: [] })).rejects.toThrow(
        '[circi] exit code 1',
      )

      // Without wait the exit code isn't the job's to give.
      const quiet = setup({ uploadImpl: () => Promise.resolve({ exitCode: 1 }) })
      await screenshot(quiet.cypress, { name: 'a' })
      await expect(quiet.cypress.fire('after:run', { runs: [] })).resolves.toBeUndefined()
    })
  })
})
