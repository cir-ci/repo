import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { type Browser, type BrowserContext, chromium, type Page } from 'playwright'

import type { Session } from './admin.ts'
import { clientAddressHeaders, freshIp } from './client-address.ts'
import { ARTIFACTS_DIR } from './paths.ts'

/**
 * Chromium with `host.docker.internal` mapped to loopback, so a fake running on the host (an
 * OIDC provider, a fake GitHub) has the same address for the container, which reaches it through
 * `extra_hosts: host-gateway`, and for the browser.
 */
export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: !process.env['E2E_HEADED'],
    args: ['--host-resolver-rules=MAP host.docker.internal 127.0.0.1'],
  })
}

/** Playwright's default wait for an element, navigation or action: fail fast. */
export const PLAYWRIGHT_TIMEOUT_MS = 10_000

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
