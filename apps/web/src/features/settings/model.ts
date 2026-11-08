import { isValidSlug } from '@circi/core/slug'

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
  if (!input.clientId) problems.clientId = 'Enter the client id'
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
