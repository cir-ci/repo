import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import type { Browser, Page } from 'playwright'

import { sleep } from '#fakes/http.ts'
import { ARTIFACTS_DIR } from '#stack/paths.ts'

import { Session } from './admin.ts'
import { openSession, PLAYWRIGHT_TIMEOUT_MS, recordDiagnostics } from './browser.ts'
import { clientAddressHeaders, freshIp } from './client-address.ts'
import { extractCode, type Mailbox } from './mail.ts'

/**
 * Helpers for the tests about people: invitations, members, email codes and single sign-on.
 * (Additive: nothing here changes how the older helpers behave.)
 */

export { freshIp } from './client-address.ts'

/** A second, independent browser (own cookies, optional user agent) for "another person". */
export async function withBrowser<T>(
  browser: Browser,
  options: { userAgent?: string },
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: clientAddressHeaders(freshIp()),
    ...(options.userAgent ? { userAgent: options.userAgent } : {}),
  })
  context.setDefaultTimeout(PLAYWRIGHT_TIMEOUT_MS)
  const diagnostics = recordDiagnostics(context)
  const page = await context.newPage()
  try {
    return await fn(page)
  } catch (err) {
    const dir = join(ARTIFACTS_DIR, 'browser')
    mkdirSync(dir, { recursive: true })
    const stamp = Date.now()
    await page
      .screenshot({ path: join(dir, `second-browser-${stamp}.png`), fullPage: true })
      .catch(() => undefined)
    await diagnostics.save(join(dir, `second-browser-${stamp}`), page).catch(() => undefined)
    throw err
  } finally {
    await context.close().catch(() => undefined)
  }
}

/** A signed-in second browser for an API session, closed afterwards. */
export async function withSessionPage<T>(
  browser: Browser,
  session: Session,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const opened = await openSession(browser, { session })
  let failed = true
  try {
    const out = await fn(opened.page)
    failed = false
    return out
  } finally {
    await opened.finish(failed, 'second-browser')
  }
}

/** better-auth's full workspace (members and invitations), as the dashboard loads it. */
export interface FullWorkspace {
  id: string
  name: string
  slug: string
  members: { id: string; userId: string; role: string; user: { email: string; name: string } }[]
  invitations: { id: string; email: string; role: string; status: string; expiresAt: string }[]
}

export function fullWorkspace(session: Session, workspaceSlug: string): Promise<FullWorkspace> {
  return session.get<FullWorkspace>(
    `/api/auth/organization/get-full-organization?organizationSlug=${encodeURIComponent(workspaceSlug)}`,
  )
}

/** The ids of the mail already sent to an address: a baseline for `waitForNewMail`. */
export async function mailIds(mail: Mailbox, to: string): Promise<Set<string>> {
  return new Set((await mail.to(to)).map((m) => m.ID))
}

/**
 * Waits for a message to `to` whose id is not in `seen` (the container's and the host's clocks may
 * differ, so this does not compare timestamps).
 */
export async function waitForNewMail(
  mail: Mailbox,
  to: string,
  seen: Set<string>,
  options: { subject?: string | RegExp; timeoutMs?: number } = {},
): Promise<Mailbox.Message> {
  const deadline = Date.now() + (options.timeoutMs ?? 30_000)
  const subject = options.subject
  for (;;) {
    const found = (await mail.to(to)).find(
      (m) =>
        !seen.has(m.ID) &&
        (subject === undefined ||
          (typeof subject === 'string' ? m.Subject.includes(subject) : subject.test(m.Subject))),
    )
    if (found) return mail.message(found.ID)
    if (Date.now() > deadline) throw new Error(`No new mail to ${to} within the timeout`)
    await sleep(250)
  }
}

/** Asks for an emailed sign-in code through the real API; returns the HTTP status. */
export async function requestCode(
  baseUrl: string,
  email: string,
  options: { address?: string } = {},
): Promise<number> {
  const res = await fetch(`${baseUrl}/api/auth/email-otp/send-verification-otp`, {
    method: 'POST',
    headers: {
      ...clientAddressHeaders(options.address ?? freshIp()),
      origin: baseUrl,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, type: 'sign-in' }),
  })
  return res.status
}

/** Tries a code through the real API; returns the status and the response cookies. */
export async function tryCode(
  baseUrl: string,
  email: string,
  otp: string,
  options: { address?: string } = {},
): Promise<{ status: number; setCookies: string[]; body: unknown }> {
  const res = await fetch(`${baseUrl}/api/auth/sign-in/email-otp`, {
    method: 'POST',
    headers: {
      ...clientAddressHeaders(options.address ?? freshIp()),
      origin: baseUrl,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, otp }),
  })
  const text = await res.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    // keep the text
  }
  return { status: res.status, setCookies: res.headers.getSetCookie(), body }
}

/**
 * Signs in on the sign-in page with an emailed code: asks for it, reads it from Mailpit, types it.
 * Resolves once the signed-in shell shows.
 */
export async function signInWithCodeThroughUi(
  page: Page,
  baseUrl: string,
  mail: Mailbox,
  email: string,
): Promise<void> {
  const seen = await mailIds(mail, email)
  await page.goto(`${baseUrl}/login`)
  // With the password form showing, "Email me a code" switches to the code form; where the
  // instance only offers codes the form is already there (its button then submits).
  await page.getByLabel('Email').waitFor()
  if ((await page.getByLabel('Password').count()) > 0) {
    await page.getByRole('button', { name: 'Email me a code' }).click()
  }
  await page.getByRole('button', { name: 'Email me a code' }).waitFor()
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Email me a code' }).click()
  const code = extractCode(await waitForNewMail(mail, email, seen, { subject: 'sign-in code' }))
  await page.getByLabel('6-digit code').fill(code)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('button', { name: /^Account menu for / }).waitFor()
}

/** Signs in with an emailed code through the real API and returns the session (cookie jar). */
export async function signInWithCode(
  baseUrl: string,
  mail: Mailbox,
  email: string,
): Promise<Session> {
  const seen = await mailIds(mail, email)
  const address = freshIp()
  const status = await requestCode(baseUrl, email, { address })
  if (status !== 200) throw new Error(`asking for a code for ${email} failed: ${status}`)
  const code = extractCode(await waitForNewMail(mail, email, seen, { subject: 'sign-in code' }))
  const res = await tryCode(baseUrl, email, code, { address })
  if (res.status !== 200) throw new Error(`code sign-in for ${email} failed: ${res.status}`)
  return new Session(baseUrl, email, res.setCookies, address)
}

/** Asks for a code and returns the status and body (to compare what known and unknown addresses see). */
export async function requestCodeRaw(
  baseUrl: string,
  email: string,
  options: { address?: string } = {},
): Promise<{ status: number; body: unknown; retryAfter: number | undefined }> {
  const res = await fetch(`${baseUrl}/api/auth/email-otp/send-verification-otp`, {
    method: 'POST',
    headers: {
      ...clientAddressHeaders(options.address ?? freshIp()),
      origin: baseUrl,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, type: 'sign-in' }),
  })
  const text = await res.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    // keep the text
  }
  const retry = Number(res.headers.get('x-retry-after'))
  return {
    status: res.status,
    body,
    retryAfter: Number.isFinite(retry) && retry > 0 ? retry : undefined,
  }
}
