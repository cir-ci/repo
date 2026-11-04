import { ValidationError } from './errors.ts'

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/

/** Reserved because they collide with app routes under `zop.example.com/<org>/…`. */
const RESERVED = new Set([
  'admin',
  'api',
  'app',
  'assets',
  'auth',
  'healthz',
  'login',
  'logout',
  'readyz',
  'settings',
  'setup',
  'static',
  'v1',
  'webhooks',
])

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && !slug.includes('--') && !RESERVED.has(slug)
}

export function assertValidSlug(slug: string, what = 'slug'): void {
  if (!isValidSlug(slug)) {
    throw new ValidationError(
      `Invalid ${what} "${slug}": use 1–40 lowercase letters, digits or single hyphens, not starting or ending with a hyphen${RESERVED.has(slug) ? ' (this name is reserved)' : ''}`,
    )
  }
}

/** Best-effort slug from a display name. The caller must still validate the result. */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 40)
    .replace(/-+$/g, '')
}
