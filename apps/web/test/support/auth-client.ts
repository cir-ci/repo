import { vi } from 'vitest'

import type { SessionUser } from '#lib/auth-client.ts'

type Fn = (arg: unknown) => Promise<unknown>

/** The parts of better-auth's browser client the dashboard calls. */
export interface AuthClientFake {
  useSession: () => {
    data: { user: SessionUser } | null
    isPending: boolean
    error: { status: number } | null
  }
  signOut: ReturnType<typeof vi.fn<() => Promise<unknown>>>
  $store: { notify: (signal?: string) => void }
  organization: {
    getFullOrganization: ReturnType<typeof vi.fn<Fn>>
    inviteMember: ReturnType<typeof vi.fn<Fn>>
    cancelInvitation: ReturnType<typeof vi.fn<Fn>>
    removeMember: ReturnType<typeof vi.fn<Fn>>
    updateMemberRole: ReturnType<typeof vi.fn<Fn>>
    getInvitation: Fn
  }
}

/** Ada, the person every page test is signed in as unless it says otherwise. */
export const ADA: SessionUser = {
  id: 'u1',
  name: 'Ada Lovelace',
  email: 'ada@example.test',
  image: null,
}

let user: SessionUser | null = ADA
let pending = false
let sessionError: { status: number } | null = null

const defaults = {
  useSession: () => ({
    data: user ? { user } : null,
    isPending: pending,
    error: sessionError,
  }),
  signOut: vi.fn<() => Promise<unknown>>(),
  $store: { notify: () => {} },
  organization: {
    getFullOrganization: vi.fn<Fn>(),
    inviteMember: vi.fn<Fn>(),
    cancelInvitation: vi.fn<Fn>(),
    removeMember: vi.fn<Fn>(),
    updateMemberRole: vi.fn<Fn>(),
    getInvitation: async () => ({ data: null, error: new Error('none') }),
  },
} satisfies AuthClientFake
const fake: AuthClientFake = { ...defaults }

/** The module `#lib/auth-client.ts` is replaced by: `vi.mock('#lib/auth-client.ts', () => import('#test/support/auth-client.ts').then((m) => m.authClientModule))`. */
export const authClientModule = { authClient: fake }

/** Signs the fake client in as `next`, or out with `null`. */
export function setSignedInUser(next: SessionUser | null): void {
  user = next
}

/** Whether the session check is still running (`isPending`), and the error it ended with, if any. Re-render to see a change. */
export function setSessionCheck(next: {
  pending?: boolean
  error?: { status: number } | null
}): void {
  if (next.pending !== undefined) pending = next.pending
  if (next.error !== undefined) sessionError = next.error
}

/** Forgets calls and answers, and signs Ada back in (`setup.ts` runs it after each test). */
export function resetAuthClient(): void {
  user = ADA
  pending = false
  sessionError = null
  Object.assign(fake, defaults)
  for (const method of Object.values(fake.organization))
    if (vi.isMockFunction(method)) method.mockReset()
  fake.signOut.mockReset()
}

/** Resets the fake and applies `overrides` (e.g. `{ useSession }`); returns it for `mockResolvedValue`. */
export function mockAuthClient(overrides: Partial<AuthClientFake> = {}): AuthClientFake {
  resetAuthClient()
  return Object.assign(fake, overrides)
}
