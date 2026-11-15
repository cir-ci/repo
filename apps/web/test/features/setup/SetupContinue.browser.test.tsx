import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

// The auth client is the edge to better-auth: a fake stands in for it (the admin is signed in).
vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import { Shell } from '#app/Shell.tsx'
import { useSetupStore } from '#lib/stores/setup-store.ts'
import { mockAuthClient } from '#test/support/auth-client.ts'
import type { ReplyHandler } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const caps = (setupPending: boolean) => ({
  canCreateWorkspace: true,
  instanceAdmin: true,
  setupPending,
  lastWorkspace: null,
  manageableWorkspaces: [{ slug: 'acme', name: 'Acme', picture: null, role: 'owner' }],
  refusingWorkspaces: [],
  mailConfigured: false,
})

const finding = (level: 'ok' | 'fail', detail: string, fix: string | null = null) => ({
  id: 'storage',
  level,
  label: 'Storage',
  detail,
  value: 's3 · circi-files',
  message: detail,
  fix,
})

const checks = (...findings: ReturnType<typeof finding>[]) => ({
  findings: [
    { ...finding('ok', 'Database is current.'), id: 'database', label: 'Database' },
    ...findings,
  ],
  warned: findings.some((f) => f.level === 'fail'),
})

const created = {
  project: { slug: 'checkout-flows', name: 'Checkout flows', color: 'slate', icon: null },
  token: 'circi_secret_token_value',
}

/** What the server says while setup is pending, and after the admin finishes it. */
function server(options: { pending?: boolean; storage?: ReturnType<typeof checks> } = {}) {
  let pending = options.pending ?? true
  return {
    'GET /api/capabilities': () => ({ body: caps(pending) }),
    'GET /api/projects': { body: { projects: [] } },
    'GET /api/instance/health/checks': {
      body: options.storage ?? checks(finding('ok', 'Reachable and writable.')),
    },
    'POST /api/workspaces/acme/projects': { status: 201, body: created },
    'POST /api/instance/setup/finish': () => {
      pending = false
      return { status: 204 }
    },
  }
}

async function open(routes: Record<string, ReplyHandler>) {
  return renderPage(<Shell />, {
    api: routes,
    otherRoutes: ['/$workspace/$project'],
    viewport: [1280, 800],
  })
}

beforeEach(() => {
  mockAuthClient()
})

describe('first-run setup after the account exists (steps 3 and 4)', () => {
  it('resumes at the storage check after a reload, without asking for the account again', async () => {
    await open(server())
    await expect
      .element(page.getByRole('heading', { name: 'Set up CirCI', level: 1 }))
      .toBeVisible()
    await expect.element(page.getByText('Step 3 of 4')).toBeVisible()
    await expect.element(page.getByText('Reachable and writable.')).toBeVisible()
    await expect.element(page.getByText('s3 · circi-files')).toBeVisible()
    // Only the storage findings are shown, not the instance's other checks.
    expect(page.getByText('Database is current.').elements()).toHaveLength(0)
    expect(page.getByRole('textbox', { name: 'Setup code' }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: 'Back' }).elements()).toHaveLength(0)
  })

  it('opens the app, not the steps, once setup is done', async () => {
    await open(server({ pending: false }))
    await expect.element(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    expect(page.getByText('Step 3 of 4').elements()).toHaveLength(0)
  })

  it('shows a failing storage with what to do about it, and lets the person go on', async () => {
    await open(
      server({
        storage: checks(
          finding('fail', 'Not usable: access denied', 'Check S3_BUCKET and the credentials.'),
        ),
      }),
    )
    await expect.element(page.getByText('Not usable: access denied')).toBeVisible()
    await expect.element(page.getByText('Check S3_BUCKET and the credentials.')).toBeVisible()
    await expect.element(page.getByText('Failing')).toBeVisible()
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect.element(page.getByText('Step 4 of 4')).toBeVisible()
  })

  it('checks again on request', async () => {
    const routes = server()
    let runs = 0
    const answer = routes['GET /api/instance/health/checks']
    const fake = {
      ...routes,
      'GET /api/instance/health/checks': () => {
        runs += 1
        return answer
      },
    }
    await open(fake)
    await expect.element(page.getByText('Reachable and writable.')).toBeVisible()
    expect(runs).toBe(1)
    await page.getByRole('button', { name: 'Check again' }).click()
    await vi.waitFor(() => expect(runs).toBe(2))
  })

  it('goes on to the project step and Back to the storage check', async () => {
    await open(server())
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect.element(page.getByText('Step 4 of 4')).toBeVisible()
    await expect.element(page.getByRole('textbox', { name: 'Project name' })).toHaveFocus()
    await page.getByRole('button', { name: 'Back' }).click()
    await expect.element(page.getByText('Step 3 of 4')).toBeVisible()
  })

  it('asks for a project name before creating anything', async () => {
    const { calls } = await open(server())
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Create project' }).click()
    await expect.element(page.getByText('Enter a name')).toBeVisible()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('creates the project, ends the setup, and keeps the token on screen until Done', async () => {
    const { calls } = await open(server())
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('textbox', { name: 'Project name' }).fill('Checkout flows')
    await page.getByRole('button', { name: 'Create project' }).click()

    await expect.element(page.getByText('circi_secret_token_value').first()).toBeVisible()
    await expect.element(page.getByRole('tab', { name: 'GitHub Actions' })).toBeVisible()
    // The board shows the token, the one-time warning and the snippet, without the dialog's extra lines.
    expect(page.getByText('Then, after your tests').elements()).toHaveLength(0)
    expect(page.getByText('Save the token as a repository secret').elements()).toHaveLength(0)
    await vi.waitFor(() =>
      expect(calls.some((c) => c.path === '/api/instance/setup/finish')).toBe(true),
    )
    expect(calls.find((c) => c.path === '/api/workspaces/acme/projects')?.body).toMatchObject({
      name: 'Checkout flows',
    })
    // The server's setup is over, but the page stays: the token is shown once.
    await new Promise((r) => setTimeout(r, 300))
    await expect.element(page.getByText('circi_secret_token_value').first()).toBeVisible()
    expect(useSetupStore.getState().project?.slug).toBe('checkout-flows')

    await page.getByRole('button', { name: 'Done' }).click()
    await vi.waitFor(() => expect(useSetupStore.getState().project).toBeUndefined())
    expect(page.getByText('Step 4 of 4').elements()).toHaveLength(0)
  })

  it('skips the project and opens the app', async () => {
    const { calls } = await open(server())
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Skip for now' }).click()
    await expect.element(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    expect(calls.some((c) => c.path === '/api/instance/setup/finish')).toBe(true)
    expect(calls.some((c) => c.path === '/api/workspaces/acme/projects')).toBe(false)
  })
})
