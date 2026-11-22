import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import type { uploadSite } from '@circi/cli'
import { describe, expect, it } from 'vitest'

import { isHtmlReporterEntry, watchHtmlReporter } from '#src/html-report.ts'
import { circi } from '#src/plugin.ts'
import { CirciReporter } from '#src/reporter.ts'

import { useTempRoot } from './support/temp-root.ts'

const tmp = useTempRoot()

/** Stands in for `@vitest/ui`'s reporter: written slowly, at the end of the run, to `<root>/<outputDir>`. */
class HTMLReporter {
  options: { outputDir?: string }
  root: string
  constructor(root: string, outputDir?: string) {
    this.root = root
    this.options = outputDir ? { outputDir } : {}
  }
  async onTestRunEnd() {
    await sleep(60)
    const dir = join(this.root, this.options.outputDir ?? '.vitest')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'index.html'), '<html></html>')
  }
}

/** One run's end with the given options: the screenshots upload, then the site decision. */
async function endRun(
  options: CirciReporter.Options,
  {
    html = true,
    upload = async () => ({ exitCode: 0 as const }),
    outputDir,
  }: {
    html?: boolean
    upload?: NonNullable<CirciReporter.Options['uploadImpl']>
    outputDir?: string
  } = {},
) {
  const lines: string[] = []
  const sites: { dir: string; name: string; kind?: string; indexExisted: boolean }[] = []
  const htmlReporter = new HTMLReporter(tmp.root(), outputDir)
  const reporter = new CirciReporter({
    apiUrl: 'https://ci.acme.io',
    token: 'circi_t',
    uploadImpl: upload,
    uploadSiteImpl: async (o: uploadSite.Options) => {
      sites.push({
        dir: o.dir,
        name: o.name ?? '',
        ...(o.kind ? { kind: o.kind } : {}),
        indexExisted: existsSync(join(o.dir, 'index.html')),
      })
    },
    log: (line) => void lines.push(line),
    ...options,
  })
  reporter.onInit({ config: { root: tmp.root() }, reporters: html ? [reporter, htmlReporter] : [] })
  // Vitest calls every reporter's onTestRunEnd at once, ours first here.
  const before = process.exitCode
  await Promise.all([
    reporter.onTestRunEnd([], [], 'passed'),
    htmlReporter.onTestRunEnd(),
  ] as Promise<unknown>[])
  const exitCode = process.exitCode
  process.exitCode = before
  return { lines, sites, exitCode }
}

const failingSite = (options: CirciReporter.Options) =>
  endRun({
    site: true,
    uploadSiteImpl: async () => {
      throw new Error('too big')
    },
    ...options,
  })

describe('hosting the HTML report', () => {
  it('uploads the report as a vitest-report site, once the HTML reporter has finished writing it', async () => {
    await tmp.touch('.circi/screenshots/vitest/a.png')
    // The HTML reporter is registered after ours and writes slowly: the upload must wait for it.
    const { sites } = await endRun({ site: true })
    expect(sites).toEqual([
      {
        dir: join(tmp.root(), '.vitest'),
        name: 'vitest-report',
        kind: 'vitest-report',
        indexExisted: true,
      },
    ])
  })

  it('does nothing unless asked', async () => {
    await tmp.touch('.circi/screenshots/vitest/a.png')
    const { sites, lines } = await endRun({})
    expect(sites).toEqual([])
    expect(lines.join('\n')).not.toContain('site')
  })

  it("says once how to get the report when Vitest's html reporter isn't there, and doesn't fail", async () => {
    await tmp.touch('.circi/screenshots/vitest/a.png')
    const { sites, lines, exitCode } = await endRun({ site: true, strict: true }, { html: false })
    expect(sites).toEqual([])
    expect(lines.filter((l) => l.includes('site skipped'))).toEqual([
      expect.stringContaining("reporters: ['default', 'html']"),
    ])
    expect(exitCode).toBe(process.exitCode)
  })

  it('hosts a folder of your own with site.dir, under the name you give', async () => {
    await tmp.touch('.circi/screenshots/vitest/a.png')
    await tmp.touch('report/index.html')
    const { sites } = await endRun(
      { site: { dir: 'report', name: 'unit-report' } },
      { html: false },
    )
    expect(sites).toEqual([
      expect.objectContaining({
        dir: join(tmp.root(), 'report'),
        name: 'unit-report',
        indexExisted: true,
      }),
    ])
  })

  it("follows the HTML reporter's outputDir", async () => {
    await tmp.touch('.circi/screenshots/vitest/a.png')
    const { sites } = await endRun({ site: true }, { outputDir: 'out/html' })
    expect(sites[0]?.dir).toBe(join(tmp.root(), 'out/html'))
  })

  it('is left to the first shard', async () => {
    await tmp.touch('.circi/screenshots/vitest/a.png')
    const second = await endRun({ site: true, shard: { index: 1, total: 2 } })
    expect(second.sites).toEqual([])
    const first = await endRun({ site: true, shard: { index: 0, total: 2 } })
    expect(first.sites).toHaveLength(1)
  })

  it("is skipped when the screenshots didn't upload", async () => {
    await tmp.touch('.circi/screenshots/vitest/a.png')
    const failed = await endRun(
      { site: true },
      {
        upload: async () => {
          throw new Error('server down')
        },
      },
    )
    expect(failed.sites).toEqual([])
    const noToken = await endRun({ site: true, token: undefined, apiUrl: undefined })
    expect(noToken.sites).toEqual([])
  })

  it('reports a failed site upload, and fails the run only with strict (exit code 1)', async () => {
    await tmp.touch('.circi/screenshots/vitest/a.png')
    const lenient = await failingSite({})
    expect(lenient.lines.join('\n')).toContain('[circi] site upload failed: too big')
    expect(lenient.exitCode).toBe(process.exitCode)
    expect((await failingSite({ strict: true })).exitCode).toBe(1)
  })
})

describe('watchHtmlReporter', () => {
  it('finds the HTML reporter by its class and ignores the others', () => {
    class Other {
      name = 'other'
    }
    expect(watchHtmlReporter('/r', [new Other()])).toBeUndefined()
    expect(watchHtmlReporter('/r', undefined)).toBeUndefined()
    expect(watchHtmlReporter('/r', [new Other(), new HTMLReporter('/r')])?.dir).toBe('/r/.vitest')
  })
})

describe('the circi() plugin and the html reporter', () => {
  interface Config {
    root?: string
    test?: { reporters?: unknown[] }
  }
  const withUi = join(import.meta.dirname, '..')
  const run = (options: circi.Options, config: Config) => {
    circi(options).config(config)
    return config.test?.reporters ?? []
  }

  it('adds it when hosting the report and @vitest/ui is installed', () => {
    const reporters = run({ site: true }, { root: withUi })
    expect(reporters.slice(0, 1)).toEqual(['default'])
    expect(reporters.at(-1)).toBe('html')
  })

  it('leaves a config that has it alone, and adds nothing without site or with a site.dir', () => {
    expect(
      run({ site: true }, { root: withUi, test: { reporters: ['default', 'html'] } }),
    ).toHaveLength(3)
    expect(
      run({ site: true }, { root: withUi, test: { reporters: ['default', ['html', {}]] } }),
    ).toHaveLength(3)
    expect(run({}, { root: withUi })).not.toContain('html')
    expect(run({ site: { dir: 'report' } }, { root: withUi })).not.toContain('html')
  })

  it('recognizes the reporter in the forms a config gives it', () => {
    expect(isHtmlReporterEntry('html')).toBe(true)
    expect(isHtmlReporterEntry(['html', { outputDir: 'x' }])).toBe(true)
    expect(isHtmlReporterEntry(new HTMLReporter('/r'))).toBe(true)
    expect(isHtmlReporterEntry('default')).toBe(false)
  })
})
