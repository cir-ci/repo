import { join } from 'node:path'

import { writeCapture } from '@circi/cli'
import { STABILIZE_CSS } from '@circi/cli/names'
import type * as Playwright from 'playwright'
import type { Browser, Page } from 'playwright'

import {
  disableMotion,
  measureStory,
  readRenderState,
  readStoryContext,
  settle,
  trackErrors,
} from './page.js'
import { parseCirciParameters } from './params.ts'
import type { Story } from './stories.ts'
import type { CirciParameters, circi } from './types.ts'
import {
  asViewports,
  record,
  sameSize,
  type Size,
  storyViewport,
  viewportLabel,
} from './viewports.ts'

export interface Shot {
  /** The screenshot's name in CirCI, and its path under the captures' folder without `.png`. */
  name: string
  file: string
}

export interface CaptureSettings {
  baseUrl: string
  outDir: string
  /** Seconds a story may take to render. */
  timeout: number
  padding: number
  delay: number
  viewports: Size[]
  /** More than one browser is configured: names carry the browser. */
  multipleBrowsers: boolean
}

/** A story that couldn't be screenshotted, with a reason a person can act on. */
export class StoryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StoryError'
  }
}

export type BrowserName = circi.Browser

/** Playwright's browsers, or a message that says what to install. */
export async function launch(name: BrowserName): Promise<Browser> {
  let playwright: typeof Playwright
  try {
    playwright = await import('playwright')
  } catch (err) {
    throw new Error(
      "Couldn't load Playwright. Install it next to this package: npm install --save-dev playwright",
      { cause: err },
    )
  }
  try {
    return await playwright[name].launch()
  } catch (err) {
    const first = err instanceof Error ? (err.message.split('\n')[0] ?? '') : String(err)
    throw new Error(
      `Couldn't start ${name} (${first}). Install it with: npx playwright install ${name}`,
      { cause: err },
    )
  }
}

/**
 * Opens one story, at each viewport it should be shown at, and writes a PNG and its `.png.json`
 * (`storyId`, `browser`, `viewport`) for each. Throws a StoryError when the story can't be shot.
 * Returns no shots for a story that skips itself.
 */
export async function captureStory(
  browser: Browser,
  browserName: BrowserName,
  story: Story,
  name: string,
  settings: CaptureSettings,
): Promise<Shot[]> {
  const first = settings.viewports[0]
  if (!first) throw new Error('No viewports configured')
  const context = await browser.newContext({
    viewport: { width: first.width, height: first.height },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  })
  try {
    const page = await context.newPage()
    await page.addInitScript(disableMotion, STABILIZE_CSS)
    await page.addInitScript(trackErrors)
    const url = `${settings.baseUrl}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`
    await render(page, url, settings.timeout)
    const seen = await page.evaluate(readStoryContext)
    let params: CirciParameters
    try {
      params = parseCirciParameters(record(seen.parameters)?.circi)
    } catch (err) {
      throw new StoryError(err instanceof Error ? err.message : String(err))
    }
    if (params.skip) return []
    const chosen = storyViewport(seen)
    const sizes = params.viewports
      ? asViewports(params.viewports)
      : chosen
        ? [chosen]
        : settings.viewports
    const layout = record(seen.parameters)?.layout
    const shots: Shot[] = []
    let current: Size = first
    /* oxlint-disable no-await-in-loop -- one page, its viewports one after the other */
    for (const size of sizes) {
      if (!sameSize(size, current)) {
        await page.setViewportSize({ width: size.width, height: size.height })
        current = size
        await render(page, url, settings.timeout)
      }
      await stabilize(page, params.delay ?? settings.delay)
      const png = await shoot(page, {
        selector: params.selector ?? null,
        padding: params.padding ?? settings.padding,
        fullPage: layout === 'fullscreen' && !params.selector,
      })
      const suffix = [
        settings.multipleBrowsers ? browserName : undefined,
        settings.viewports.length > 1 || sizes.length > 1 ? viewportLabel(size) : undefined,
      ]
        .filter((part) => part !== undefined)
        .map((part) => `@${part.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)
        .join('')
      const shotName = `${name}${suffix}`
      const file = join(settings.outDir, `${shotName}.png`)
      await writeCapture(file, png, {
        storyId: story.id,
        browser: browserName,
        viewport: viewportLabel(size),
      })
      shots.push({ name: shotName, file })
    }
    /* oxlint-enable no-await-in-loop */
    return shots
  } finally {
    await context.close()
  }
}

/** Loads the story and waits for Storybook to say it has rendered, `play` function included. */
async function render(page: Page, url: string, timeoutSeconds: number): Promise<void> {
  await page.goto(url, { waitUntil: 'load', timeout: timeoutSeconds * 1000 })
  let state: Awaited<ReturnType<typeof readRenderState>>
  try {
    const handle = await page.waitForFunction(readRenderState, undefined, {
      timeout: timeoutSeconds * 1000,
      polling: 50,
    })
    state = await handle.jsonValue()
  } catch {
    throw new StoryError(
      `didn't finish rendering within ${timeoutSeconds} s (is its play function stuck?)`,
    )
  }
  if (state?.state === 'error') throw new StoryError(`failed: ${state.message ?? 'it threw'}`)
}

async function stabilize(page: Page, delay: number): Promise<void> {
  await page.evaluate(settle)
  // A story that keeps polling the network never goes idle: carry on after a moment.
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined)
  if (delay > 0) await page.waitForTimeout(delay)
}

async function shoot(
  page: Page,
  options: { selector: string | null; padding: number; fullPage: boolean },
): Promise<Buffer> {
  const measured = await page.evaluate(measureStory, options.selector)
  if (measured.missing) {
    throw new StoryError(`parameters.circi.selector "${options.selector}" matched nothing`)
  }
  const { box } = measured
  if (!box) throw new StoryError('rendered nothing: its root is empty or invisible')
  const common = { animations: 'disabled', caret: 'hide', type: 'png' } as const
  if (options.fullPage) return page.screenshot({ ...common, fullPage: true })
  const x = Math.max(0, Math.floor(box.x - options.padding))
  const y = Math.max(0, Math.floor(box.y - options.padding))
  const right = Math.min(measured.pageWidth, Math.ceil(box.x + box.width + options.padding))
  const bottom = Math.min(measured.pageHeight, Math.ceil(box.y + box.height + options.padding))
  if (right - x < 1 || bottom - y < 1) {
    throw new StoryError('rendered nothing: its content is outside the page')
  }
  return page.screenshot({
    ...common,
    fullPage: true,
    clip: { x, y, width: right - x, height: bottom - y },
  })
}
