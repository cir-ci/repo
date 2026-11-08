import { clientAddressHeaders, freshIp } from './client-address.ts'
import type { Stack } from './stack.ts'

export interface ApiResponse<T = unknown> {
  status: number
  body: T
  headers: Headers
}

/**
 * A signed-in browser-like client of the dashboard API: keeps the cookie jar from the real
 * `/api/auth` sign-in and sends the dashboard's own origin (the API rejects other origins).
 */
export class Session {
  readonly url: string
  readonly email: string
  /** The client address this person's requests come from (own per session, see `freshIp`). */
  readonly address: string
  #cookies = new Map<string, string>()

  constructor(url: string, email: string, setCookies: string[], address: string = freshIp()) {
    this.url = url
    this.email = email
    this.address = address
    this.#absorb(setCookies)
  }

  #absorb(setCookies: string[]) {
    for (const line of setCookies) {
      const [pair = ''] = line.split(';')
      const eq = pair.indexOf('=')
      if (eq < 1) continue
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      // An expired or emptied cookie (sign-out) leaves the jar.
      if (value === '' || /max-age=0/i.test(line)) this.#cookies.delete(name)
      else this.#cookies.set(name, value)
    }
  }

  get cookieHeader(): string {
    return [...this.#cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  /** The cookies in Playwright's `addCookies` shape, to start a browser already signed in. */
  playwrightCookies(): { name: string; value: string; url: string }[] {
    return [...this.#cookies].map(([name, value]) => ({ name, value, url: this.url }))
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResponse<T>> {
    const res = await fetch(`${this.url}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        ...clientAddressHeaders(this.address),
        origin: this.url,
        cookie: this.cookieHeader,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    this.#absorb(res.headers.getSetCookie())
    const text = await res.text()
    let parsed: unknown = text
    try {
      parsed = text ? JSON.parse(text) : undefined
    } catch {
      // not JSON: keep the text
    }
    return { status: res.status, body: parsed as T, headers: res.headers }
  }

  /** Like `request`, but throws unless the status is 2xx; returns the parsed body. */
  async call<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.request<T>(method, path, body)
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(res.body)}`)
    }
    return res.body
  }

  get<T = unknown>(path: string) {
    return this.call<T>('GET', path)
  }
  post<T = unknown>(path: string, body?: unknown) {
    return this.call<T>('POST', path, body ?? {})
  }
  patch<T = unknown>(path: string, body?: unknown) {
    return this.call<T>('PATCH', path, body ?? {})
  }
  put<T = unknown>(path: string, body?: unknown) {
    return this.call<T>('PUT', path, body ?? {})
  }
  delete<T = unknown>(path: string) {
    return this.call<T>('DELETE', path)
  }

  async signOut(): Promise<void> {
    await this.post('/api/auth/sign-out')
  }
}

/** Signs in through the real `POST /api/auth/sign-in/email`. */
export async function signIn(
  target: Pick<Stack, 'url'> | string,
  email: string,
  password: string,
): Promise<Session> {
  const url = typeof target === 'string' ? target : target.url
  // Its own client address, so better-auth's per-address sign-in limit never sees two people.
  const address = freshIp()
  const res = await fetch(`${url}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      ...clientAddressHeaders(address),
      origin: url,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error(`sign-in as ${email} failed: ${res.status} ${await res.text()}`)
  return new Session(url, email, res.headers.getSetCookie(), address)
}

export interface Account {
  email: string
  password: string
  name: string
}

let accountCounter = 0
/** A unique account (`user<n>-<rand>@e2e.test`) with a valid password; nothing is created. */
export function newAccount(label = 'user'): Account {
  accountCounter += 1
  const tag = `${accountCounter}-${Math.random().toString(36).slice(2, 6)}`
  return {
    email: `${label}${tag}@e2e.test`,
    password: `correct-horse-${tag}-battery`,
    name: `${label[0]?.toUpperCase()}${label.slice(1)} ${tag}`,
  }
}

export namespace completeSetup {
  export interface Result {
    account: Account
    organization: { name: string; slug: string }
    session: Session
  }
}

/**
 * First-run setup through the real HTTP flow: the setup code comes from `circi admin setup-code`
 * in the container (the same value the server log prints), `POST /api/setup` creates the first
 * account, an instance admin, and its organization; then it signs in.
 */
export async function completeSetup(
  stack: Stack,
  options: { account?: Account; organizationName?: string } = {},
): Promise<completeSetup.Result> {
  const account = options.account ?? newAccount('admin')
  const organizationName = options.organizationName ?? 'Acme'
  const code = await stack.setupCode()
  const res = await fetch(`${stack.url}/api/setup`, {
    method: 'POST',
    headers: {
      ...clientAddressHeaders(freshIp()),
      origin: stack.url,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      code,
      name: account.name,
      email: account.email,
      password: account.password,
      organizationName,
    }),
  })
  if (res.status !== 201) throw new Error(`setup failed: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { organization: { slug: string } }
  const session = await signIn(stack, account.email, account.password)
  return {
    account,
    organization: { name: organizationName, slug: body.organization.slug },
    session,
  }
}

/**
 * Approves a build through the dashboard API, as a member would. A project's first build has no
 * baseline and is never approved automatically, so tests approve it before relying on it.
 */
export function approveBuild(
  session: Session,
  org: string,
  slug: string,
  buildNumber: number,
): Promise<unknown> {
  return session.post(`/api/projects/${org}/${slug}/builds/${buildNumber}/review`, {
    state: 'approved',
  })
}

export interface CreatedProject {
  slug: string
  name: string
  /** The CI token (`CIRCI_TOKEN`), shown once. */
  token: string
}

/** `POST /api/organizations/:org/projects`, as the dashboard's "New project" dialog does. */
export async function createProject(
  session: Session,
  orgSlug: string,
  name: string,
): Promise<CreatedProject> {
  const res = await session.post<{ project: { slug: string; name: string }; token: string }>(
    `/api/organizations/${encodeURIComponent(orgSlug)}/projects`,
    { name },
  )
  return { slug: res.project.slug, name: res.project.name, token: res.token }
}

/** `POST /api/organizations` (instance admins, or anyone with `ORG_CREATION=anyone`). */
export async function createOrganization(
  session: Session,
  name: string,
): Promise<{ slug: string }> {
  const res = await session.post<{ organization: { slug: string } }>('/api/organizations', { name })
  return { slug: res.organization.slug }
}

/** Creates an account with `circi admin user create` (there is no self sign-up). */
export async function createUserViaCli(
  stack: Stack,
  options: { account?: Account; instanceAdmin?: boolean } = {},
): Promise<Account> {
  const account = options.account ?? newAccount()
  await stack.cli(
    'user',
    'create',
    '--email',
    account.email,
    '--name',
    account.name,
    '--password',
    account.password,
    ...(options.instanceAdmin ? ['--instance-admin'] : []),
  )
  return account
}

/** `circi admin member add`. */
export async function addMemberViaCli(
  stack: Stack,
  org: string,
  email: string,
  role: 'owner' | 'admin' | 'member' = 'member',
): Promise<void> {
  await stack.cli('member', 'add', '--org', org, '--email', email, '--role', role)
}

/** Invites an email address to an organization through better-auth's organization API. */
export async function inviteMember(
  session: Session,
  orgSlug: string,
  email: string,
  role: 'admin' | 'member' = 'member',
): Promise<{ id: string }> {
  const org = await session.get<{ id: string }>(
    `/api/auth/organization/get-full-organization?organizationSlug=${encodeURIComponent(orgSlug)}`,
  )
  return session.post<{ id: string }>('/api/auth/organization/invite-member', {
    email,
    role,
    organizationId: org.id,
  })
}

export namespace createTenant {
  export interface Options {
    /** Base of the organization name; a unique tag is appended (default `Acme`). */
    name?: string
    /** The owner is an instance admin like the first-run account (default true). */
    instanceAdmin?: boolean
    /** Also create a project with this name. */
    project?: string
  }
}

/** A tenant of a (possibly shared) stack: its own organization, owner account and signed-in session. */
export interface Tenant extends completeSetup.Result {
  project: CreatedProject | undefined
}

/**
 * A fresh organization with its own owner and, optionally, a project, all through the real API
 * and CLI: tests that do this cannot see each other's data, so many can share one stack.
 * `admin` is an instance admin session of the stack (the first-run account); it creates the
 * organization when the owner is not an instance admin itself.
 */
export async function createTenant(
  stack: Stack,
  admin: Session,
  options: createTenant.Options = {},
): Promise<Tenant> {
  const instanceAdmin = options.instanceAdmin ?? true
  const account = newAccount('owner')
  const tag = /owner(\d+-\w+)@/.exec(account.email)?.[1] ?? ''
  const organizationName = `${options.name ?? 'Acme'} ${tag}`.trim()
  await createUserViaCli(stack, { account, instanceAdmin })
  let creator = admin
  if (instanceAdmin) creator = await signIn(stack, account.email, account.password)
  const { slug } = await createOrganization(creator, organizationName)
  if (!instanceAdmin) await addMemberViaCli(stack, slug, account.email, 'owner')
  const session = instanceAdmin ? creator : await signIn(stack, account.email, account.password)
  const project = options.project ? await createProject(session, slug, options.project) : undefined
  return { account, organization: { name: organizationName, slug }, session, project }
}
