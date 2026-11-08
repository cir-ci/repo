/** A short, readable name for a browser's user-agent string, e.g. "Firefox on macOS". */
export function describeAgent(agent: string | null | undefined): string {
  if (!agent) return 'Unknown device'
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /OPR\/|Opera/.test(agent)
      ? 'Opera'
      : /Firefox\//.test(agent)
        ? 'Firefox'
        : /Chrome\//.test(agent)
          ? 'Chrome'
          : /Safari\//.test(agent)
            ? 'Safari'
            : /curl\//.test(agent)
              ? 'curl'
              : 'Browser'
  const os = /Windows/.test(agent)
    ? 'Windows'
    : /iPhone|iPad/.test(agent)
      ? 'iOS'
      : /Android/.test(agent)
        ? 'Android'
        : /Mac OS X/.test(agent)
          ? 'macOS'
          : /Linux/.test(agent)
            ? 'Linux'
            : ''
  return os ? `${browser} on ${os}` : browser
}

/** The server refuses shorter passwords (`MIN_PASSWORD_LENGTH` in `@circi/auth`). */
export const MIN_PASSWORD_LENGTH = 12

const PROVIDER_NAME: Record<string, string> = {
  github: 'GitHub',
  google: 'Google',
  gitlab: 'GitLab',
  microsoft: 'Microsoft',
  bitbucket: 'Bitbucket',
}

/** "github" → "GitHub"; an unknown provider keeps its id. */
export const providerName = (providerId: string) => PROVIDER_NAME[providerId] ?? providerId

/** One linked login, as better-auth's `listAccounts` reports it. */
export interface LinkedAccount {
  id: string
  providerId: string
  accountId: string
  updatedAt: Date | string
}

/** The password account is better-auth's `credential` one; every other account is a linked provider. */
export const isPassword = (a: Pick<LinkedAccount, 'providerId'>) => a.providerId === 'credential'

/**
 * The rows of "Signed in with": every linked provider, then each provider the instance offers
 * that isn't linked yet. The password account is not one of them (it has its own section).
 */
export function providerRows(
  accounts: readonly LinkedAccount[],
  offered: readonly { id: string; name: string }[],
) {
  const linked = accounts
    .filter((a) => !isPassword(a))
    .map((a) => ({
      id: a.providerId,
      name: offered.find((o) => o.id === a.providerId)?.name ?? providerName(a.providerId),
      account: a,
    }))
  const free = offered
    .filter((o) => !accounts.some((a) => a.providerId === o.id))
    .map((o) => ({ id: o.id, name: o.name, account: undefined }))
  return [...linked, ...free]
}

export interface PasswordDraft {
  current: string
  next: string
  confirm: string
}

export function passwordProblems(
  draft: PasswordDraft,
): Partial<Record<keyof PasswordDraft, string>> {
  const problems: Partial<Record<keyof PasswordDraft, string>> = {}
  if (!draft.current) problems.current = 'Enter your current password'
  if (draft.next.length < MIN_PASSWORD_LENGTH) {
    problems.next = `Use at least ${MIN_PASSWORD_LENGTH} characters`
  } else if (draft.next === draft.current) {
    problems.next = 'Choose a different password from the current one'
  }
  if (draft.confirm !== draft.next) problems.confirm = 'The two passwords don’t match'
  return problems
}

/** Whether the name differs from what is saved (surrounding spaces don't count). */
export const nameDirty = (saved: string, draft: string) =>
  draft.trim() !== saved && draft.trim() !== ''
