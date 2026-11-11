import { createHash } from 'node:crypto'

/**
 * The hostnames sites are served from (PLAN §7.6): `<hash>-<site-slug>.<sites domain>`, one DNS
 * label each. A commit's label starts with its SHA, a branch's with a hash of its name (branch
 * names can contain characters DNS doesn't allow, or be too long).
 */

/** DNS labels are at most 63 characters: 16 (longest hash) + 1 + 46 (longest slug). */
export const MAX_SLUG_LENGTH = 46
export const HASH_LENGTH = 12
export const LONG_HASH_LENGTH = 16

export function commitHash(sha: string, length = HASH_LENGTH): string {
  return sha.toLowerCase().slice(0, length)
}

export function branchHash(branch: string, length = HASH_LENGTH): string {
  return createHash('sha256').update(branch).digest('hex').slice(0, length)
}

/** A site slug candidate: lowercase letters, digits and single hyphens, cut and tidied. */
export function siteSlug(text: string, max = MAX_SLUG_LENGTH): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, max)
    .replace(/-+$/, '')
}

/**
 * The slug for a project's site, trying in order: `<project>-<name>`, then with the
 * workspace appended, then numbered. The first one `taken` doesn't claim wins; each is cut to
 * 46 characters *before* its suffix, so a suffix never pushes it over.
 */
export function chooseSlug(
  input: { project: string; name: string; workspace: string },
  taken: (slug: string) => boolean,
): string {
  const base = siteSlug(`${input.project}-${input.name}`)
  if (!taken(base)) return base
  const withWorkspace = `${siteSlug(`${input.project}-${input.name}`, MAX_SLUG_LENGTH - 1 - input.workspace.length)}-${siteSlug(input.workspace)}`
  const trimmed = withWorkspace.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '')
  if (!taken(trimmed)) return trimmed
  for (let n = 2; n < 1000; n += 1) {
    const suffix = `-${n}`
    const candidate = `${trimmed.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`
    if (!taken(candidate)) return candidate
  }
  throw new Error('no free site slug')
}

export const labelFor = (hash: string, slug: string) => `${hash}-${slug}`

/** `3f9c2ab41d07-web-storybook` → its parts; undefined for anything that isn't an address. */
export function parseLabel(label: string): { hash: string; slug: string } | undefined {
  const m = /^([0-9a-f]{12}|[0-9a-f]{16})-([a-z0-9](?:[a-z0-9-]{0,44}[a-z0-9])?)$/.exec(label)
  return m?.[1] && m[2] ? { hash: m[1], slug: m[2] } : undefined
}

/**
 * The label to claim: 12 hash characters, or 16 when `exists` says the short one is taken (by
 * another commit with the same prefix, or a branch hash equal to a commit prefix).
 */
export function pickLabel(
  hash16: string,
  slug: string,
  exists: (label: string) => boolean,
): string {
  const short = labelFor(hash16.slice(0, HASH_LENGTH), slug)
  return exists(short) ? labelFor(hash16.slice(0, LONG_HASH_LENGTH), slug) : short
}

/**
 * The single DNS label of `host` under `sitesHost`, or undefined when `host` isn't exactly one
 * label below it (no apex, no deeper names, no look-alikes).
 */
export function labelOf(host: string, sitesHost: string): string | undefined {
  const bare = host.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
  const suffix = `.${sitesHost.toLowerCase()}`
  if (!bare.endsWith(suffix)) return undefined
  const label = bare.slice(0, -suffix.length)
  return label.length > 0 && !label.includes('.') ? label : undefined
}

/**
 * The full address of a site address: a hostname label becomes `<label>.<sites domain>`, a custom
 * domain (it has dots) is the host itself. Scheme and port follow the dashboard's.
 */
export function siteOrigin(publicOrigin: string, sitesHost: string, address: string): string {
  const url = new URL(publicOrigin)
  const host = address.includes('.') ? address : `${address}.${sitesHost}`
  return `${url.protocol}//${host}${url.port ? `:${url.port}` : ''}`
}
