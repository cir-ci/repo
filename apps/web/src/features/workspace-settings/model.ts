import { isValidSlug, WORKSPACE_PICTURE_MAX_BYTES, WORKSPACE_PICTURE_TYPES } from '@circi/core'

/** What the workspace General page edits: the name and the address. */
export interface GeneralDraft {
  name: string
  slug: string
}

export function generalProblems(draft: GeneralDraft): { name?: string; slug?: string } {
  const problems: { name?: string; slug?: string } = {}
  const name = draft.name.trim()
  if (!name) problems.name = 'Enter a name'
  else if (name.length > 100) problems.name = 'Use at most 100 characters'
  if (!draft.slug) problems.slug = 'Enter an address'
  else if (!isValidSlug(draft.slug)) {
    problems.slug =
      'Use up to 40 lowercase letters, digits or single hyphens, not starting or ending with a hyphen'
  }
  return problems
}

export const generalDirty = (saved: GeneralDraft, draft: GeneralDraft) =>
  saved.name !== draft.name.trim() || saved.slug !== draft.slug

/** The request body: only what changed. */
export function generalPatch(saved: GeneralDraft, draft: GeneralDraft) {
  return {
    ...(saved.name === draft.name.trim() ? {} : { name: draft.name.trim() }),
    ...(saved.slug === draft.slug ? {} : { slug: draft.slug }),
  }
}

/** Retention days as typed: a whole number, at least 1 (what the server accepts). */
export function retentionProblem(text: string): string | null {
  const t = text.trim()
  if (!/^\d+$/.test(t) || Number(t) < 1) return 'Enter a whole number of days, at least 1'
  return null
}

export const retentionDirty = (saved: number, text: string) => String(saved) !== text.trim()

type Problems<K extends string> = Partial<Record<K, string>>

export function validateDomain(domain: string): Problems<'domain'> {
  if (!domain) return { domain: 'Enter a domain, like example.com' }
  if (!/^[^\s@/:]+\.[^\s@/:]+$/.test(domain))
    return { domain: 'Enter just the domain, like example.com' }
  return {}
}

export function validateSso(input: {
  issuer: string
  clientId: string
  clientSecret: string
}): Problems<'issuer' | 'clientId' | 'clientSecret'> {
  const problems: Problems<'issuer' | 'clientId' | 'clientSecret'> = {}
  if (!input.issuer) problems.issuer = 'Enter the issuer address'
  else if (!isWebAddress(input.issuer))
    problems.issuer = 'Enter a full address, like https://login.example.com'
  if (!input.clientId) problems.clientId = 'Enter the client ID'
  if (!input.clientSecret) problems.clientSecret = 'Enter the client secret'
  return problems
}

function isWebAddress(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

const teamCount = (n: number) => `${n} ${n === 1 ? 'team' : 'teams'}`

/**
 * How the teams relate to the merge gate default: "2 teams inherit this, 1 overrides it", and the
 * overriding teams with their own setting ("marketing-site: off").
 */
export function inheritance(teams: readonly { name: string; flakyBlocksMerge: boolean | null }[]): {
  summary: string
  overrides: string[]
} {
  const overriding = teams.filter((t) => t.flakyBlocksMerge !== null)
  const inherit = teams.length - overriding.length
  const first = `${teamCount(inherit)} ${inherit === 1 ? 'inherits' : 'inherit'} this`
  return {
    summary:
      overriding.length === 0
        ? first
        : `${first}, ${overriding.length} ${overriding.length === 1 ? 'overrides' : 'override'} it`,
    overrides: overriding.map((t) => `${t.name}: ${t.flakyBlocksMerge ? 'on' : 'off'}`),
  }
}

/** Whether what was typed is the workspace's address (surrounding spaces don't count; case does). */
export const slugConfirmed = (typed: string, slug: string): boolean =>
  slug !== '' && typed.trim() === slug

/** What is wrong with a file chosen as the workspace's picture, or null when it can be sent. */
export function pictureProblem(file: { type: string; size: number }): string | null {
  if (!(WORKSPACE_PICTURE_TYPES as readonly string[]).includes(file.type)) {
    return 'Use a PNG, JPEG or WebP image'
  }
  if (file.size > WORKSPACE_PICTURE_MAX_BYTES) return 'Use an image of at most 1 MB'
  return null
}

/** The sign-in methods as the page shows them: on or off. */
export interface MethodsDraft {
  password: boolean
  email: boolean
  github: boolean
  google: boolean
}

/** The request body: only the methods that changed, under the names the server uses. */
export function methodsPatch(saved: MethodsDraft, draft: MethodsDraft) {
  return {
    ...(saved.password === draft.password ? {} : { passwordLoginEnabled: draft.password }),
    ...(saved.email === draft.email ? {} : { emailLoginEnabled: draft.email }),
    ...(saved.github === draft.github ? {} : { signinGithub: draft.github }),
    ...(saved.google === draft.google ? {} : { signinGoogle: draft.google }),
  }
}
