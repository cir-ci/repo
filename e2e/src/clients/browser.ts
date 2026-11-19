import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { type Browser, type BrowserContext, chromium, type Page } from 'playwright'

import { ARTIFACTS_DIR } from '#stack/paths.ts'

import type { Session } from './admin.ts'
import { clientAddressHeaders, freshIp } from './client-address.ts'
import { browserEnv } from './no-netlink.ts'

/**
 * Chromium with `host.docker.internal` mapped to loopback, so a fake running on the host (an
 * OIDC provider, a fake GitHub) has the same address for the container, which reaches it through
 * `extra_hosts: host-gateway`, and for the browser. On Linux it never hears of the host's network
 * changes (`browserEnv`): other workers' stacks starting and stopping would abort its requests.
 */
export async function launchBrowser(): Promise<Browser> {
  const env = browserEnv()
  return chromium.launch({
    headless: !process.env['E2E_HEADED'],
    args: ['--host-resolver-rules=MAP host.docker.internal 127.0.0.1'],
    ...(env ? { env } : {}),
  })
}

/**
 * Playwright's default wait for an element, navigation or action. A wait that is met returns at
 * once, so the figure only matters when something is wrong; it is generous because a CI machine
 * running the stacks, Chromium and the other group at once loads the dashboard (a cold bundle, a
 * reload, a password hash) several times slower than a laptop, and 10 s failed there on tests that
 * pass in seconds. A test that waits for something slower says so itself.
 */
export const PLAYWRIGHT_TIMEOUT_MS = 30_000

/**
 * `E2E_CPU_THROTTLE=4` slows every page of the context to a quarter of the speed (Chrome's CPU
 * throttling), to reproduce locally what a small CI machine does to the dashboard's timing.
 */
function throttleCpu(context: BrowserContext): void {
  const rate = Number(process.env['E2E_CPU_THROTTLE'] ?? 1)
  if (!(rate > 1)) return
  context.on('page', (page) => {
    void context
      .newCDPSession(page)
      .then((session) => session.send('Emulation.setCPUThrottlingRate', { rate }))
      .catch(() => undefined)
  })
}

/**
 * What a stuck page leaves behind: its console errors, page errors, failed requests, HTTP errors
 * and navigations, with the time of each, and (when saved) the text it shows and what its service
 * worker did. A page that never draws the control a test waits for is the hardest failure to read
 * from a screenshot alone; these lines say whether a script threw, a request failed or the server
 * answered with an error.
 */
export interface PageDiagnostics {
  /** Writes `page.log` (the events) and `page-state.txt` (what the page shows now) into `dir`. */
  save(dir: string, page: Page): Promise<void>
}

export function recordDiagnostics(context: BrowserContext): PageDiagnostics {
  const began = Date.now()
  const lines: string[] = []
  const log = (kind: string, text: string) =>
    lines.push(`${((Date.now() - began) / 1000).toFixed(1).padStart(6)}s ${kind} ${text}`)
  context.on('page', (page) => {
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') log(`console.${m.type()}`, m.text())
    })
    page.on('pageerror', (e) => log('pageerror', e.stack ?? e.message))
    page.on('requestfailed', (r) =>
      log('requestfailed', `${r.method()} ${r.url()} ${r.failure()?.errorText ?? ''}`),
    )
    page.on('response', (r) => {
      if (r.status() >= 400) log('response', `${r.status()} ${r.request().method()} ${r.url()}`)
    })
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) log('navigated', f.url())
    })
    page.on('crash', () => log('crash', 'the page crashed'))
  })
  context.on('serviceworker', (worker) => log('serviceworker', worker.url()))
  return {
    async save(dir, page) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'page.log'), `${lines.join('\n')}\n`)
      const state = await page
        .evaluate<string>(
          `(async () => {
            const registration = await navigator.serviceWorker?.getRegistration()
            return [
              'url: ' + location.href,
              'title: ' + document.title,
              'readyState: ' + document.readyState,
              'serviceWorker: controller=' + (navigator.serviceWorker?.controller?.state ?? 'none') + ' active=' + (registration?.active?.state ?? 'none'),
              'body text:\\n' + document.body.innerText.slice(0, 3000),
            ].join('\\n')
          })()`,
        )
        .catch((err: unknown) => `the page could not be read: ${String(err)}`)
      writeFileSync(join(dir, 'page-state.txt'), `${state}\n`)
    },
  }
}

export interface BrowserSession {
  context: BrowserContext
  page: Page
  /** Saves a trace and a screenshot to `e2e/.artifacts/` when `failed`; otherwise discards the trace. */
  finish(failed: boolean, label: string): Promise<string | undefined>
}

/** A fresh context + page (own cookies), traced; the trace is kept only when the test fails. */
export async function openSession(
  browser: Browser,
  options: {
    session?: Session
    viewport?: { width: number; height: number }
    colorScheme?: 'light' | 'dark'
  } = {},
): Promise<BrowserSession> {
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1280, height: 800 },
    colorScheme: options.colorScheme ?? 'light',
    // Its own client address (the person's, when it is a session): see `freshIp`.
    extraHTTPHeaders: clientAddressHeaders(options.session?.address ?? freshIp()),
  })
  context.setDefaultTimeout(PLAYWRIGHT_TIMEOUT_MS)
  throttleCpu(context)
  const diagnostics = recordDiagnostics(context)
  if (options.session) await context.addCookies(options.session.playwrightCookies())
  await context.tracing.start({ screenshots: true, snapshots: true })
  const page = await context.newPage()
  return {
    context,
    page,
    async finish(failed, label) {
      let dir: string | undefined
      if (failed) {
        dir = join(ARTIFACTS_DIR, 'browser', label.replace(/[^a-z0-9._-]+/gi, '_').slice(0, 120))
        mkdirSync(dir, { recursive: true })
        await page
          .screenshot({ path: join(dir, 'failure.png'), fullPage: true })
          .catch(() => undefined)
        await diagnostics.save(dir, page).catch(() => undefined)
        await context.tracing.stop({ path: join(dir, 'trace.zip') }).catch(() => undefined)
      } else {
        await context.tracing.stop().catch(() => undefined)
      }
      await context.close().catch(() => undefined)
      return dir
    },
  }
}

/** Signs in through the real sign-in page and waits for the signed-in shell. */
export async function signInThroughUi(
  page: Page,
  baseUrl: string,
  account: { email: string; password: string; name: string },
): Promise<void> {
  await page.goto(`${baseUrl}/login`)
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(account.password)
  await submitSignIn(page, account.name)
}

/** Clicks "Sign in" and waits for the signed-in shell. */
export async function submitSignIn(page: Page, accountName: string): Promise<void> {
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('button', { name: `Account menu for ${accountName}` }).waitFor()
}

/** Signs out through the account menu. */
export async function signOutThroughUi(page: Page, accountName: string): Promise<void> {
  await page.getByRole('button', { name: `Account menu for ${accountName}` }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
}
