/**
 * GitHub's App Manifest flow (one click creates the App): the manifest CirCI sends, the address it
 * is posted to, and the exchange of GitHub's temporary code for the App's credentials.
 * https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
 */

/**
 * What the GitHub App needs, and nothing more: checks (the CirCI check run with its buttons),
 * pull requests (the summary comment and its reactions) and metadata (always read-only).
 * The same list the manual setup in the README names.
 */
export const GITHUB_APP_PERMISSIONS = {
  checks: 'write',
  pull_requests: 'write',
  metadata: 'read',
} as const

/** Pull requests (author linking), the check's buttons, and `/circi` comments. */
export const GITHUB_APP_EVENTS = ['check_run', 'issue_comment', 'pull_request'] as const

/** GitHub limits an App's name to 34 characters. */
export const GITHUB_APP_NAME_MAX = 34

export interface GithubManifest {
  name: string
  url: string
  hook_attributes: { url: string; active: boolean }
  redirect_url: string
  setup_url: string
  setup_on_update: boolean
  public: boolean
  default_permissions: Record<string, string>
  default_events: string[]
}

/** The default App name: unique per instance because it names the host. */
export function defaultGithubAppName(publicUrl: string): string {
  return `CirCI (${new URL(publicUrl).hostname})`.slice(0, GITHUB_APP_NAME_MAX)
}

/** `publicUrl` is the dashboard's origin (`PUBLIC_URL`). */
export function buildGithubManifest(input: { publicUrl: string; name?: string }): GithubManifest {
  const origin = new URL(input.publicUrl).origin
  const name = (input.name?.trim() || defaultGithubAppName(origin)).slice(0, GITHUB_APP_NAME_MAX)
  return {
    name,
    url: origin,
    hook_attributes: { url: `${origin}/api/integrations/github/webhook`, active: true },
    redirect_url: `${origin}/api/instance/github-app/callback`,
    setup_url: `${origin}/api/integrations/github/setup`,
    setup_on_update: true,
    public: false,
    default_permissions: { ...GITHUB_APP_PERMISSIONS },
    default_events: [...GITHUB_APP_EVENTS],
  }
}

/** GitHub's web address for an API address: github.com, or a GitHub Enterprise Server's host. */
export function githubWebBase(apiUrl: string): string {
  const url = new URL(apiUrl)
  if (url.hostname === 'api.github.com') return 'https://github.com'
  return `${url.origin}${url.pathname.replace(/\/api\/v3\/?$/, '').replace(/\/$/, '')}`
}

/** Where the manifest is posted: the account's or an organisation's "new GitHub App" page. */
export function githubManifestPostUrl(apiUrl: string, organization?: string): string {
  const base = githubWebBase(apiUrl)
  return organization
    ? `${base}/organizations/${encodeURIComponent(organization)}/settings/apps/new`
    : `${base}/settings/apps/new`
}

export interface GithubAppCredentials {
  appId: string
  slug: string
  clientId: string
  clientSecret: string
  /** The private key (PEM). */
  privateKey: string
  webhookSecret: string
  /** The App's public page, `https://github.com/apps/<slug>`. */
  htmlUrl: string
}

export class GithubManifestError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'GithubManifestError'
    this.status = status
  }
}

const webAddress = (value: string | undefined) =>
  value && /^https?:\/\/[^\s]+$/.test(value) ? value.replace(/\/$/, '') : undefined

const text = (data: object, key: string): string | undefined => {
  const value: unknown = Reflect.get(data, key)
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Exchanges the temporary code from the manifest redirect for the App's credentials. No
 * authentication: the code is the proof, and GitHub accepts it once, within an hour (a second try
 * is a 404, which is a `GithubManifestError` here).
 */
export async function convertGithubManifestCode(
  apiUrl: string,
  code: string,
  fetcher: typeof fetch = fetch,
): Promise<GithubAppCredentials> {
  const res = await fetcher(`${apiUrl}/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: 'POST',
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'CirCI' },
    signal: AbortSignal.timeout(15_000),
  })
  const raw = await res.text()
  let data: unknown
  try {
    data = raw ? JSON.parse(raw) : undefined
  } catch {
    data = undefined
  }
  if (!res.ok) {
    throw new GithubManifestError(
      res.status,
      `GitHub didn't accept the code (HTTP ${res.status}); it works once, so start again`,
    )
  }
  if (typeof data !== 'object' || data === null) {
    throw new GithubManifestError(502, 'GitHub sent an unreadable answer')
  }
  const id: unknown = Reflect.get(data, 'id')
  const appId = typeof id === 'number' || typeof id === 'string' ? String(id) : undefined
  const slug = text(data, 'slug')
  const privateKey = text(data, 'pem')
  const webhookSecret = text(data, 'webhook_secret')
  const clientId = text(data, 'client_id')
  const clientSecret = text(data, 'client_secret')
  if (!appId || !slug || !privateKey || !webhookSecret || !clientId || !clientSecret) {
    throw new GithubManifestError(502, "GitHub answered without the App's credentials")
  }
  return {
    appId,
    slug,
    clientId,
    clientSecret,
    privateKey,
    webhookSecret,
    htmlUrl: webAddress(text(data, 'html_url')) ?? `${githubWebBase(apiUrl)}/apps/${slug}`,
  }
}
