import type { Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { signIn } from '#clients/admin.ts'
import { signInThroughUi, signOutThroughUi } from '#clients/browser.ts'
import { type PendingBuildFixture, seedPendingBuild } from '#clients/seed-builds.ts'
import { useBrowser, useStack } from '#stack/vitest.ts'

/**
 * What the dashboard keeps in the browser (a service worker, a Cache Storage for screenshots, the
 * query cache in IndexedDB, a few `localStorage` keys), proven in a real Chromium against the
 * built image: what is kept, that it is served without the network, and that none of it outlives
 * the session or reaches another person on the same browser profile.
 */

const SHELL_CACHE = 'circi-shell-v1'
const IMAGE_CACHE = 'circi-images-v1'
const PRIVATE_KEYS = [
  'circi-session-hint',
  'circi-recent',
  'circi-recent-searches',
  'circi-tabs',
] as const
const SHOT = /\/api\/files\/[0-9a-f]{64}/

/** The page's service worker is active and controls it (a first load is not controlled until it claims). */
async function waitForWorker(page: Page): Promise<void> {
  await page.evaluate<unknown>(`(async () => {
    await navigator.serviceWorker.ready
    if (navigator.serviceWorker.controller) return true
    await new Promise((resolve) =>
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(true), { once: true }),
    )
    return true
  })()`)
}

interface Stored {
  caches: string[]
  imageKeys: string[]
  queryKeys: string[]
  /** Everything stored in the query cache, as one text. */
  queryText: string
  local: Record<string, string>
}

/** What the page's browser profile holds of the dashboard right now. */
function storage(page: Page): Promise<Stored> {
  return page.evaluate<Stored>(`(async () => {
    const names = ${JSON.stringify(PRIVATE_KEYS)}
    const cacheNames = await caches.keys()
    const imageKeys = cacheNames.includes('${IMAGE_CACHE}')
      ? (await (await caches.open('${IMAGE_CACHE}')).keys()).map((r) => r.url)
      : []
    const queried = await new Promise((resolve) => {
      const open = indexedDB.open('circi-cache')
      open.onerror = () => resolve({ keys: [], text: '' })
      open.onsuccess = () => {
        const db = open.result
        if (!db.objectStoreNames.contains('queries')) {
          db.close()
          resolve({ keys: [], text: '' })
          return
        }
        const store = db.transaction('queries').objectStore('queries')
        const keys = store.getAllKeys()
        const values = store.getAll()
        values.onsuccess = () => {
          db.close()
          resolve({ keys: keys.result.map(String), text: values.result.join('\\n') })
        }
        values.onerror = () => {
          db.close()
          resolve({ keys: [], text: '' })
        }
      }
    })
    const local = {}
    for (const name of names) {
      const value = localStorage.getItem(name)
      if (value !== null) local[name] = value
    }
    return { caches: cacheNames, imageKeys, queryKeys: queried.keys, queryText: queried.text, local }
  })()`)
}

/** What a fetch of the screenshot's bare path (or with a bad signature) answers, as the page sees it. */
function fetchShot(
  page: Page,
  sha: string,
  query: string,
): Promise<{ status: number; stamped: boolean }> {
  return page.evaluate<{ status: number; stamped: boolean }>(`(async () => {
    const response = await fetch('/api/files/${sha}${query}')
    return { status: response.status, stamped: response.headers.has('x-circi-owner') }
  })()`)
}

/** Opens the command menu, searches `text` and opens the first result: the search is remembered. */
async function searchAndOpen(page: Page, text: string): Promise<void> {
  await page.keyboard.press('Control+k')
  const box = page.getByRole('combobox')
  await box.fill(text)
  await page.getByRole('option').first().waitFor()
  await page.keyboard.press('Enter')
  await page.getByRole('combobox').waitFor({ state: 'hidden' })
}

describe('what the dashboard keeps in the browser', () => {
  const ctx = useStack({ profile: 'default', setup: true })
  const browser = useBrowser()
  let fixture: PendingBuildFixture
  let userId: string

  beforeAll(async () => {
    const { stack, setup } = ctx
    fixture = await seedPendingBuild(stack, setup.session, setup.workspace.slug, 'Cache app')
    const me = await setup.session.get<{ user: { id: string } }>('/api/auth/get-session')
    userId = me.user.id
  })
  afterAll(async () => {
    await fixture.destroy()
  })

  /** A browser signed in as the tenant's owner on a session of its own (the API session stays valid). */
  const signedInPage = async () => {
    const { stack, setup } = ctx
    const own = await signIn(stack, setup.account.email, setup.account.password)
    return { page: await browser.as(own), own }
  }

  it('precaches the build, keeps a screenshot by its path and serves it from the cache on the next visit', async () => {
    const { stack } = ctx
    const { page } = await signedInPage()
    await page.goto(`${stack.url}${fixture.path}`)
    await waitForWorker(page)

    // The files this build's worker was told to fetch ahead: written into sw.js by the build.
    const script = await (await fetch(`${stack.url}/sw.js`)).text()
    const manifest = [...new Set(script.match(/\/assets\/[\w.-]+\.[a-z0-9]+/g) ?? [])].filter(
      (p) => !p.endsWith('.map'),
    )
    expect(manifest.length).toBeGreaterThan(20)

    // After the page is idle the worker fetches every one of them into its cache.
    await expect
      .poll(
        () =>
          page.evaluate<number>(`(async () => {
            const cache = await caches.open('${SHELL_CACHE}')
            const kept = new Set((await cache.keys()).map((r) => new URL(r.url).pathname))
            return ${JSON.stringify(manifest)}.filter((p) => !kept.has(p)).length
          })()`),
        { timeout: 90_000, interval: 500 },
      )
      .toBe(0)

    // The first visit's screenshots are kept under their path, without the hourly signature.
    const image = page.locator('img[src*="/api/files/"]').first()
    await image.waitFor()
    await expect
      .poll(async () => (await storage(page)).imageKeys.length, { timeout: 15_000 })
      .toBeGreaterThan(0)
    const kept = (await storage(page)).imageKeys
    for (const key of kept) {
      expect(key).toMatch(/\/api\/files\/[0-9a-f]{64}$/)
      expect(key).not.toContain('?')
    }
    expect(kept).toContain(`${stack.url}/api/files/${fixture.imageSha}`)

    // The second visit: the kept screenshots go through the worker, and a request with no valid
    // signature at all is answered with the stored copy (it carries the owner stamp only a stored
    // copy has; the server would refuse it), because the copy is looked up by path.
    const answers: { url: string; fromWorker: boolean }[] = []
    page.on('response', (response) => {
      if (SHOT.test(response.url())) {
        answers.push({
          url: response.url(),
          fromWorker: response.fromServiceWorker(),
        })
      }
    })
    await page.reload()
    await page.locator('img[src*="/api/files/"]').first().waitFor()
    await expect.poll(() => answers.length).toBeGreaterThan(0)
    // (A file first shown on this visit, not kept before, comes from the network and is kept now.)
    const again = answers.filter((a) => kept.includes(a.url.split('?')[0] ?? ''))
    expect(again.length).toBeGreaterThan(0)
    expect(again.filter((a) => !a.fromWorker)).toEqual([])
    expect(again.map((a) => a.url)).toContainEqual(expect.stringContaining(fixture.imageSha))
    const unsigned = await fetchShot(page, fixture.imageSha, '?sig=not-a-signature&exp=1')
    expect(unsigned).toEqual({ status: 200, stamped: true })
  }, 150_000)

  it('signing out empties the screenshots, the query cache, the remembered person and the recent searches, visits and tabs', async () => {
    const { stack, setup } = ctx
    const { page } = await signedInPage()
    await page.goto(`${stack.url}${fixture.path}`)
    await waitForWorker(page)
    await page.reload()
    await page.locator('img[src*="/api/files/"]').first().waitFor()
    await searchAndOpen(page, 'Cache app')
    await page.goto(`${stack.url}${fixture.path}`)
    await page.locator('img[src*="/api/files/"]').first().waitFor()

    // All of it is there while signed in.
    await expect
      .poll(
        async () => {
          const s = await storage(page)
          return [
            s.imageKeys.length > 0,
            s.queryKeys.includes(`user:${userId}`),
            'circi-session-hint' in s.local,
            'circi-recent' in s.local,
            'circi-recent-searches' in s.local,
          ]
        },
        { timeout: 15_000 },
      )
      .toEqual([true, true, true, true, true])

    await signOutThroughUi(page, setup.account.name)
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor()
    await expect
      .poll(
        async () => {
          const s = await storage(page)
          return {
            images: s.caches.includes(IMAGE_CACHE),
            queries: s.queryKeys,
            local: Object.keys(s.local),
          }
        },
        { timeout: 15_000 },
      )
      .toEqual({ images: false, queries: [], local: [] })
  })

  it("another person on the same browser profile never sees the first one's pages, screenshots or searches", async () => {
    const { stack, setup } = ctx
    const other = await ctx.tenant({ instanceAdmin: false, project: 'Other app' })
    const { page } = await signedInPage()
    await page.goto(`${stack.url}${fixture.path}`)
    await waitForWorker(page)
    await page.reload()
    await page.locator('img[src*="/api/files/"]').first().waitFor()
    await searchAndOpen(page, 'Cache app')
    await expect
      .poll(async () => (await storage(page)).imageKeys.length, { timeout: 15_000 })
      .toBeGreaterThan(0)

    await signOutThroughUi(page, setup.account.name)
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor()
    await signInThroughUi(page, stack.url, other.account)
    await page.getByText('Other app').first().waitFor()

    const now = await storage(page)
    const otherId = (await other.session.get<{ user: { id: string } }>('/api/auth/get-session'))
      .user.id
    expect(now.queryKeys.filter((k) => k !== `user:${otherId}`)).toEqual([])
    expect(now.imageKeys).toEqual([])
    expect(JSON.stringify(now.local)).not.toContain('Cache app')

    // Nothing of the first person's is on screen, and their page doesn't draw from a cache.
    await page.goto(`${stack.url}${fixture.path}`)
    await page
      .getByText('Cache app')
      .first()
      .waitFor({ state: 'hidden', timeout: 5_000 })
      .catch(() => undefined)
    await expect(page.locator('img[src*="/api/files/"]').count()).resolves.toBe(0)
    const served = await fetchShot(page, fixture.imageSha, '')
    expect(served.stamped).toBe(false)
    expect(served.status).not.toBe(200)
  }, 120_000)

  it('a session revoked on the server is dropped at the next request, with everything stored for it', async () => {
    const { stack, setup } = ctx
    const { page, own } = await signedInPage()
    await page.goto(`${stack.url}${fixture.path}`)
    await waitForWorker(page)
    await page.reload()
    await page.locator('img[src*="/api/files/"]').first().waitFor()
    await searchAndOpen(page, 'Cache app')
    await expect
      .poll(async () => (await storage(page)).queryKeys.length, { timeout: 15_000 })
      .toBeGreaterThan(0)

    // Another device of the same account signs this one out.
    const elsewhere = await signIn(stack, setup.account.email, setup.account.password)
    await elsewhere.post('/api/auth/revoke-other-sessions')
    expect((await own.request('GET', '/api/projects')).status).toBe(401)

    await page.reload()
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor()
    await expect
      .poll(
        async () => {
          const s = await storage(page)
          return {
            images: s.caches.includes(IMAGE_CACHE),
            queries: s.queryKeys,
            local: Object.keys(s.local),
          }
        },
        { timeout: 15_000 },
      )
      .toEqual({ images: false, queries: [], local: [] })
  }, 90_000)

  it('signing out in one tab empties the other tab too, and it stores nothing again', async () => {
    const { stack, setup } = ctx
    const { page: first } = await signedInPage()
    await first.goto(`${stack.url}${fixture.path}`)
    await first.getByRole('button', { name: `Account menu for ${setup.account.name}` }).waitFor()
    const second = await browser.context.newPage()
    await second.goto(`${stack.url}${fixture.projectPath}`)
    await second.getByRole('button', { name: `Account menu for ${setup.account.name}` }).waitFor()
    await expect
      .poll(async () => (await storage(second)).queryKeys, { timeout: 15_000 })
      .toContain(`user:${userId}`)

    await signOutThroughUi(first, setup.account.name)
    await first.getByRole('button', { name: 'Sign in', exact: true }).waitFor()

    // The second tab leaves the app (its session is gone) and its store is empty.
    await second.getByRole('button', { name: 'Sign in', exact: true }).waitFor()
    const s = await storage(second)
    expect(s.queryKeys).toEqual([])
    expect(Object.keys(s.local)).toEqual([])
  }, 90_000)

  it('reloading while signed in draws the app and its data before the session check and the API answer', async () => {
    const { stack, setup } = ctx
    const { page } = await signedInPage()
    await page.goto(`${stack.url}${fixture.projectPath}`)
    await page.getByRole('button', { name: `Account menu for ${setup.account.name}` }).waitFor()
    // The cache is written (throttled) and the person remembered.
    await expect
      .poll(async () => (await storage(page)).queryKeys, { timeout: 15_000 })
      .toContain(`user:${userId}`)
    await expect
      .poll(async () => (await storage(page)).queryText, { timeout: 15_000 })
      .toContain('Cache app')

    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    let answered = false
    await page.route(/\/api\/(?!live|files)/, async (route) => {
      await gate
      answered = true
      await route.continue()
    })
    await page.reload({ waitUntil: 'commit' })

    // Nothing has answered yet, and the app is there with this project from the stored cache.
    await page.getByRole('button', { name: `Account menu for ${setup.account.name}` }).waitFor()
    await page.getByText('Cache app').first().waitFor()
    expect(answered).toBe(false)
    await expect(page.getByRole('button', { name: 'Sign in', exact: true }).count()).resolves.toBe(
      0,
    )

    release()
    await expect.poll(() => answered).toBe(true)
    await page.getByText('Cache app').first().waitFor()
  }, 90_000)
})
