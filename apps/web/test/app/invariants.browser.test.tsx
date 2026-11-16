import { CirciTheme } from '@circi/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

// The auth client is the edge to better-auth: a fake stands in for it (nothing here talks to a server).
const auth = vi.hoisted(() => ({
  user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.test' } as {
    id: string
    name: string
    email: string
  } | null,
}))
vi.mock('#lib/auth-client.ts', () => ({
  authClient: {
    useSession: () => ({
      data: auth.user ? { user: auth.user, session: { id: 's1', token: 't' } } : null,
      isPending: false,
    }),
    listSessions: async () => ({ data: [], error: null }),
    listAccounts: async () => ({ data: [], error: null }),
    signOut: async () => {},
    signIn: { email: async () => ({ data: null, error: new Error('no') }) },
    $store: { notify: () => {} },
    organization: { getInvitation: async () => ({ data: null, error: new Error('none') }) },
  },
}))

import { createAppRouter } from '#app/router.tsx'
import { resetStores } from '#lib/stores/index.ts'
import { fakeFetch, hangingFetch, restoreFetch } from '#test/features/fetch-routes.ts'

/** What each `$param` of an address stands for in this test. */
const SAMPLE: Record<string, string> = {
  workspace: 'acme',
  project: 'web',
  number: '1',
  kind: 'github',
  id: '8c1b0a52-6d3f-4a39-9f0e-5a3a1d7f2b11',
  view: 'v1',
}
const address = (path: string) =>
  path.replaceAll(/\$(\w+)/g, (_, name: string) => SAMPLE[name] ?? 'x')

/** Every address the app declares (redirects included: they end on a page that must have its h1 too). */
const PATHS = Object.keys(createAppRouter().routesByPath).filter((p) => p !== '/*')

type Scheme = 'light' | 'dark'

async function open(url: string) {
  resetStores()
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [url] }) })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await render(
    <CirciTheme mode="light">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </CirciTheme>,
  )
  return { router, queryClient }
}

const h1s = () => page.getByRole('heading', { level: 1 }).elements()
const frame = () => new Promise<void>((done) => requestAnimationFrame(() => done()))

/**
 * Waits until the page has settled, without a fixed sleep: the h1 is there, the router has
 * finished navigating and (unless the network hangs on purpose) no query is in flight.
 */
async function settle(opened: Awaited<ReturnType<typeof open>>, networkAnswers: boolean) {
  await expect
    .poll(
      () =>
        h1s().length > 0 &&
        opened.router.state.status === 'idle' &&
        (!networkAnswers || opened.queryClient.isFetching() === 0),
      { timeout: 5_000 },
    )
    .toBe(true)
  // Let the render that follows the last response commit.
  await frame()
  await frame()
}

function setScheme(scheme: Scheme) {
  document.documentElement.dataset['circiColorScheme'] = scheme
}

const INTERACTIVE =
  'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=menuitem], [role=switch], [role=checkbox], [role=link], [role=combobox]'

const visible = (el: Element) => {
  const box = el.getBoundingClientRect()
  const style = getComputedStyle(el)
  return box.width > 0 && box.height > 0 && style.visibility !== 'hidden'
}

/** The accessible name, as far as the platform computes it (aria-label(ledby), label, content, title). */
function nameOf(el: Element): string {
  const aria = el.getAttribute('aria-label')?.trim()
  if (aria) return aria
  const by = el.getAttribute('aria-labelledby')
  if (by) {
    const text = by
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .join(' ')
      .trim()
    if (text) return text
  }
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
  ) {
    if ([...(el.labels ?? [])].some((l) => l.textContent?.trim())) return 'label'
    if (el instanceof HTMLInputElement && el.placeholder) return el.placeholder
  }
  if (el.textContent?.trim()) return el.textContent.trim()
  if (el.querySelector('img[alt]:not([alt=""]), svg title')) return 'image'
  return el.getAttribute('title')?.trim() ?? ''
}

const describeEl = (el: Element) =>
  `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} "${(el.textContent ?? '').trim().slice(0, 30)}" in ${el.parentElement?.className ?? ''}`

/**
 * axe-core's rules that hold here. `color-contrast` is left out: it needs the final composited
 * colours and is noisy over translucent surfaces and loading skeletons; the design tokens' contrast
 * is covered by packages/ui/test/theme.test.ts. `region` is off: error and loading states are
 * deliberately bare.
 */
async function axeViolations() {
  const result = await axe.run(document.body, {
    runOnly: ['wcag2a', 'wcag2aa', 'best-practice'],
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  })
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  )
}

/** Every DOM invariant over the page as it is now. */
async function check(scheme: Scheme) {
  const problems: string[] = []
  setScheme(scheme)
  await frame()
  if (h1s().length !== 1) problems.push(`${h1s().length} h1s`)
  const mains = document.querySelectorAll('main, [role=main]').length
  if (mains !== 1) problems.push(`${mains} main landmarks`)
  const controls = [...document.querySelectorAll(INTERACTIVE)].filter(visible)
  for (const el of controls) {
    // Not perceivable (the native proxy input behind a custom Select or radio: transparent or 1px),
    // so it needs no name or size; the visible control carries both.
    const own = el.getBoundingClientRect()
    if (getComputedStyle(el).opacity === '0' || (own.width <= 1 && own.height <= 1)) continue
    if (!nameOf(el)) problems.push(`no accessible name: ${describeEl(el)}`)
    const box = own
    // Exempt (WCAG 2.5.8): a link inside a sentence.
    const inline =
      el instanceof HTMLAnchorElement &&
      getComputedStyle(el).display === 'inline' &&
      (el.parentElement?.textContent ?? '').trim() !== (el.textContent ?? '').trim()
    // A control inside its label (a Switch's row) is pressed through the whole label: that is the target.
    const label = el.closest('label')?.getBoundingClientRect()
    const labelled = label !== undefined && label.width >= 24 && label.height >= 24
    if (!inline && !labelled && (box.width < 24 || box.height < 24)) {
      problems.push(
        `target under 24px (${Math.round(box.width)}x${Math.round(box.height)}): ${describeEl(el)}`,
      )
    }
  }
  for (const v of await axeViolations()) problems.push(`axe ${v}`)
  return problems
}

/** The first tabbable element must show where the keyboard is. */
async function focusRingProblems() {
  await userEvent.tab()
  const el = document.activeElement
  if (!el || el === document.body || !el.matches(':focus-visible')) return []
  const style = getComputedStyle(el)
  const ring = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
  const shadow = style.boxShadow !== 'none'
  return ring || shadow ? [] : [`no focus ring on ${describeEl(el)}`]
}

const noHorizontalScroll = () => document.documentElement.scrollWidth <= window.innerWidth

beforeEach(() => {
  auth.user = { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.test' }
})
afterEach(() => {
  restoreFetch()
  delete document.documentElement.dataset['circiColorScheme']
})

/**
 * Known offenders, by address, with the reason. Prefer fixing; entries may only shrink.
 * Keys are "<state> <path>"; values list the problem prefixes that are tolerated.
 */
const KNOWN: Record<string, { reason: string; ignore: RegExp[] }> = {}

function unexpected(key: string, problems: string[]) {
  const known = KNOWN[key]
  return problems.filter((p) => !known?.ignore.some((re) => re.test(p)))
}

describe('every page upholds the global invariants', () => {
  it("knows the app's addresses", () => {
    // A guard that the enumeration works, so the loops below cannot pass by checking nothing.
    expect(PATHS.length).toBeGreaterThan(30)
    expect(PATHS).toContain('/inbox')
    expect(PATHS).toContain('/$workspace/$project/builds/$number')
  })

  describe.each([
    ['while loading', () => hangingFetch(), false],
    [
      'when the server answers 404',
      () => void fakeFetch({ 'GET /api/setup': { needed: false } }),
      true,
    ],
  ])('%s', (state, stub, answers) => {
    it.each(PATHS)('%s', async (path) => {
      stub()
      await page.viewport(1280, 800)
      const opened = await open(address(path))
      await settle(opened, answers)
      const problems: string[] = []
      for (const p of await check('light')) problems.push(`[light] ${p}`)
      for (const p of await check('dark')) problems.push(`[dark] ${p}`)
      setScheme('light')
      problems.push(...(await focusRingProblems()))
      if (!noHorizontalScroll()) problems.push('horizontal scroll at 1280')
      await page.viewport(390, 800)
      await frame()
      if (!noHorizontalScroll()) problems.push('horizontal scroll at 390')
      expect(unexpected(`${state} ${path}`, problems)).toEqual([])
    })
  })

  it('upholds them on an address that does not exist', async () => {
    fakeFetch({})
    await page.viewport(1280, 800)
    const opened = await open('/no/such/page/at/all')
    await settle(opened, true)
    expect(await check('light')).toEqual([])
  })

  it('upholds them on the sign-in page', async () => {
    auth.user = null
    fakeFetch({
      'GET /api/setup': { needed: false },
      'GET /api/auth-methods': { password: true, email: false, sso: [] },
    })
    await page.viewport(1280, 800)
    const opened = await open('/')
    await settle(opened, true)
    const problems = [
      ...(await check('light')),
      ...(await check('dark')),
      ...(await focusRingProblems()),
    ]
    expect(problems).toEqual([])
  })
})
