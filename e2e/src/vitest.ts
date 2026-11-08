import type { Browser } from 'playwright'
import { afterAll, beforeAll, beforeEach, expect } from 'vitest'

import { type Account, completeSetup, createTenant, type Session, type Tenant } from './admin.ts'
import { type BrowserSession, launchBrowser, openSession } from './browser.ts'
import type { FakeGithub } from './fakes/fake-github.ts'
import { acquire, type Profile } from './pool.ts'
import { startStack, type Stack } from './stack.ts'

export interface StackContext {
  readonly stack: Stack
  /**
   * With `setup: true`: a dedicated stack's first admin, its organization and a signed-in API
   * session; on a shared stack, this file's own tenant (a fresh organization and owner, an instance
   * admin like the first-run account).
   */
  readonly setup: completeSetup.Result
  /** An instance admin's session (the first-run account). Needs `setup: true` or a shared stack. */
  readonly admin: Session
  /** Another fresh organization with its own owner (and optionally a project), through the API. */
  tenant(options?: createTenant.Options): Promise<Tenant>
  /** The fake GitHub of the `github` profile, reset for this file. */
  readonly github: FakeGithub
}

type SetupOption = boolean | { account?: Account; organizationName?: string }

const testFileName = () => expect.getState().testPath?.split('/').at(-1) ?? ''

type UseStackOptions =
  | {
      /**
       * A stack shared by the files of one Vitest worker (see `pool.ts`). Each file gets its own
       * tenant, so the stack is never configured per file: pass only the profile.
       */
      profile: Profile
      /** Make this file's tenant (`ctx.setup`); `organizationName` is the base of its name. */
      setup?: boolean | { organizationName?: string }
      dedicated?: false
    }
  | (Omit<Stack.Options, 'env' | 'profile' | 'pooled'> & {
      /**
       * A stack of its own for this file, removed when the file ends: for tests that change
       * instance-wide state (first-run setup, `reconfigure`, stopping a service, instance sign-in
       * settings, sweeping retention, the whole-instance limits). Also the default without `profile`.
       */
      dedicated?: true
      profile?: undefined
      /** Environment for the circi container; a function is called when the stack starts (after the `beforeAll` hooks registered before this call, e.g. the ones that start fakes). */
      env?: Record<string, string> | (() => Record<string, string>)
      setup?: SetupOption
    })

/**
 * A stack for a test file, started in `beforeAll`. `useStack({ profile, setup: true })` shares one
 * with the other files of the Vitest worker, `useStack({ dedicated: true, ... })` (or no profile)
 * starts one of its own and removes it afterwards. The service logs are written to
 * `e2e/.artifacts/` when any test of the file failed.
 *
 *   const ctx = useStack({ profile: 's3', setup: true })
 *   it('...', async () => { const { stack, setup } = ctx ... })
 */
export function useStack(options: UseStackOptions = { dedicated: true }): StackContext {
  let stack: Stack | undefined
  let setup: completeSetup.Result | undefined
  let admin: Session | undefined
  let github: FakeGithub | undefined
  let failed = false
  const shared = options.profile !== undefined

  beforeAll(async () => {
    if (options.profile !== undefined) {
      const entry = await acquire(options.profile, testFileName())
      stack = entry.stack
      admin = entry.admin
      github = entry.github
      github?.reset()
      if (options.setup) {
        const base = typeof options.setup === 'object' ? options.setup.organizationName : undefined
        const tenant = await createTenant(stack, admin, base ? { name: base } : {})
        setup = tenant
      }
      return
    }
    const {
      setup: setupOption,
      env,
      dedicated: _dedicated,
      profile: _profile,
      ...stackOptions
    } = options
    stack = await startStack({
      label: testFileName(),
      ...stackOptions,
      ...(env ? { env: typeof env === 'function' ? env() : env } : {}),
    })
    if (setupOption) {
      const began = Date.now()
      setup = await completeSetup(stack, setupOption === true ? {} : setupOption)
      admin = setup.session
      stack.phases.setup = Date.now() - began
    }
  })
  beforeEach((ctx) => {
    ctx.onTestFinished(() => {
      if (ctx.task.result?.state === 'fail') failed = true
    })
  })
  afterAll(async () => {
    if (!stack) return
    if (failed) console.log(`[e2e] logs of ${stack.project}: ${await stack.saveLogs()}`)
    // A shared stack stays for the next file of this worker (the pool removes it).
    if (!shared) await stack.stop()
  })

  return {
    get stack() {
      if (!stack) throw new Error('the stack is not started yet (use it inside a test or hook)')
      return stack
    },
    get setup() {
      if (!setup) throw new Error('pass `setup: true` to useStack() to get an organization')
      return setup
    },
    get admin() {
      if (!admin) throw new Error('pass `setup: true` to useStack() to get an admin session')
      return admin
    },
    get github() {
      if (!github) throw new Error("only the 'github' profile has a fake GitHub")
      return github
    },
    tenant: (tenantOptions) => {
      if (!stack || !admin) throw new Error('the stack is not started yet')
      return createTenant(stack, admin, tenantOptions)
    },
  }
}

export interface BrowserContextHandle {
  /** A fresh page per test (own cookies), traced. */
  readonly page: BrowserSession['page']
  readonly context: BrowserSession['context']
  readonly browser: Browser
  /** Replaces the page with one whose cookies come from an API session (already signed in). */
  as(session: Session): Promise<BrowserSession['page']>
}

/**
 * One Chromium for the file and a fresh context/page per test. A screenshot and a Playwright trace
 * are saved to `e2e/.artifacts/browser/<test>/` only when the test fails.
 */
export function useBrowser(): BrowserContextHandle {
  let browser: Browser | undefined
  let current: BrowserSession | undefined
  let label = ''

  beforeAll(async () => {
    browser = await launchBrowser()
  })
  beforeEach(async (ctx) => {
    label = `${ctx.task.file.name.split('/').at(-1) ?? 'test'}-${ctx.task.name}`
    if (!browser) throw new Error('browser not launched')
    current = await openSession(browser)
    // Runs after the test and its afterEach hooks, when the result is known.
    ctx.onTestFinished(async () => {
      const dir = await current?.finish(ctx.task.result?.state === 'fail', label)
      current = undefined
      if (dir) console.log(`[e2e] browser artifacts: ${dir}`)
    })
  })
  afterAll(async () => {
    await browser?.close()
  })

  const need = () => {
    if (!current || !browser) throw new Error('use the browser inside a test')
    return { current, browser }
  }
  return {
    get page() {
      return need().current.page
    },
    get context() {
      return need().current.context
    },
    get browser() {
      return need().browser
    },
    async as(session) {
      const { current: old, browser: b } = need()
      await old.finish(false, label)
      current = await openSession(b, { session })
      return current.page
    },
  }
}
