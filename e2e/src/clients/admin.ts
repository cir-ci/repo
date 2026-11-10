import type { Stack } from '#stack/stack.ts'

import { clientAddressHeaders, freshIp } from './client-address.ts'

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
    workspace: { name: string; slug: string }
    session: Session
  }
}

/**
 * First-run setup through the real HTTP flow: the setup code comes from `circi admin setup-code`
 * in the container (the same value the server log prints), `POST /api/setup` creates the first
 * account, an instance admin, and its workspace; then it signs in.
 */
export async function completeSetup(
  stack: Stack,
  options: { account?: Account; workspaceName?: string } = {},
): Promise<completeSetup.Result> {
  const account = options.account ?? newAccount('admin')
  const workspaceName = options.workspaceName ?? 'Acme'
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
      workspaceName,
    }),
  })
  if (res.status !== 201) throw new Error(`setup failed: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { workspace: { slug: string } }
  const session = await signIn(stack, account.email, account.password)
  return {
    account,
    workspace: { name: workspaceName, slug: body.workspace.slug },
    session,
  }
}

/**
 * Approves a build through the dashboard API, as a member would. A team's first build has no
 * baseline and is never approved automatically, so tests approve it before relying on it.
 */
export function approveBuild(
  session: Session,
  workspace: string,
  slug: string,
  buildNumber: number,
): Promise<unknown> {
  return session.post(`/api/teams/${workspace}/${slug}/builds/${buildNumber}/review`, {
    state: 'approved',
  })
}

export interface CreatedTeam {
  slug: string
  name: string
  /** The CI token (`CIRCI_TOKEN`), shown once. */
  token: string
}

/** `POST /api/workspaces/:workspace/teams`, as the dashboard's "New team" dialog does. */
export async function createTeam(
  session: Session,
  workspaceSlug: string,
  name: string,
): Promise<CreatedTeam> {
  const res = await session.post<{ team: { slug: string; name: string }; token: string }>(
    `/api/workspaces/${encodeURIComponent(workspaceSlug)}/teams`,
    { name },
  )
  return { slug: res.team.slug, name: res.team.name, token: res.token }
}

/** `POST /api/workspaces` (instance admins, or anyone with `WORKSPACE_CREATION=anyone`). */
export async function createWorkspace(session: Session, name: string): Promise<{ slug: string }> {
  const res = await session.post<{ workspace: { slug: string } }>('/api/workspaces', { name })
  return { slug: res.workspace.slug }
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
  workspace: string,
  email: string,
  role: 'owner' | 'admin' | 'member' = 'member',
): Promise<void> {
  await stack.cli('member', 'add', '--org', workspace, '--email', email, '--role', role)
}

/** `POST /api/teams/:workspace/:team/members`: puts workspace members in a team (as an owner or admin). */
export async function addTeamMembers(
  session: Session,
  workspaceSlug: string,
  teamSlug: string,
  userIds: string[],
): Promise<void> {
  await session.post(
    `/api/teams/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(teamSlug)}/members`,
    { userIds },
  )
}

/** Invites an email address to a workspace through better-auth's organization API. */
export async function inviteMember(
  session: Session,
  workspaceSlug: string,
  email: string,
  role: 'admin' | 'member' = 'member',
): Promise<{ id: string }> {
  const workspace = await session.get<{ id: string }>(
    `/api/auth/organization/get-full-organization?organizationSlug=${encodeURIComponent(workspaceSlug)}`,
  )
  return session.post<{ id: string }>('/api/auth/organization/invite-member', {
    email,
    role,
    organizationId: workspace.id,
  })
}

export namespace createTenant {
  export interface Options {
    /** Base of the workspace name; a unique tag is appended (default `Acme`). */
    name?: string
    /** The owner is an instance admin like the first-run account (default true). */
    instanceAdmin?: boolean
    /** Also create a team with this name. */
    team?: string
  }
}

/** A tenant of a (possibly shared) stack: its own workspace, owner account and signed-in session. */
export interface Tenant extends completeSetup.Result {
  team: CreatedTeam | undefined
}

/**
 * A fresh workspace with its own owner and, optionally, a team, all through the real API
 * and CLI: tests that do this cannot see each other's data, so many can share one stack.
 * `admin` is an instance admin session of the stack (the first-run account); it creates the
 * workspace when the owner is not an instance admin itself.
 */
export async function createTenant(
  stack: Stack,
  admin: Session,
  options: createTenant.Options = {},
): Promise<Tenant> {
  const instanceAdmin = options.instanceAdmin ?? true
  const account = newAccount('owner')
  const tag = /owner(\d+-\w+)@/.exec(account.email)?.[1] ?? ''
  const workspaceName = `${options.name ?? 'Acme'} ${tag}`.trim()
  await createUserViaCli(stack, { account, instanceAdmin })
  let creator = admin
  if (instanceAdmin) creator = await signIn(stack, account.email, account.password)
  const { slug } = await createWorkspace(creator, workspaceName)
  if (!instanceAdmin) await addMemberViaCli(stack, slug, account.email, 'owner')
  const session = instanceAdmin ? creator : await signIn(stack, account.email, account.password)
  const team = options.team ? await createTeam(session, slug, options.team) : undefined
  return { account, workspace: { name: workspaceName, slug }, session, team }
}
