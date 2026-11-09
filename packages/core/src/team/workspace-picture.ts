import { SHA256_RE } from '../builds/limits.ts'

/**
 * A workspace's picture. The better-auth `organization.logo` column holds a key, `picture:<sha256>`,
 * naming the stored (already resized) image; the dashboard serves it at
 * `/api/workspaces/<slug>/picture`, with the hash as a cache-busting version. A key rather than a
 * URL, so a renamed workspace keeps its picture, and so storage GC can tell which file is live.
 */

export const WORKSPACE_PICTURE_PREFIX = 'picture:'
/** Largest upload accepted, in bytes. */
export const WORKSPACE_PICTURE_MAX_BYTES = 1024 * 1024
/** The stored picture is a square this many pixels wide. */
export const WORKSPACE_PICTURE_SIZE = 256
/** The image types an upload may have. */
export const WORKSPACE_PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export const workspacePictureKey = (sha256: string) => `${WORKSPACE_PICTURE_PREFIX}${sha256}`

/** The hash a logo value names, or undefined when it is empty or something else. */
export function workspacePictureSha(logo: string | null | undefined): string | undefined {
  if (!logo?.startsWith(WORKSPACE_PICTURE_PREFIX)) return undefined
  const sha = logo.slice(WORKSPACE_PICTURE_PREFIX.length)
  return SHA256_RE.test(sha) ? sha : undefined
}

/** Where the dashboard shows a workspace's picture from, or null when it has none. */
export function workspacePictureUrl(slug: string, logo: string | null | undefined): string | null {
  const sha = workspacePictureSha(logo)
  return sha ? `/api/workspaces/${encodeURIComponent(slug)}/picture?v=${sha.slice(0, 12)}` : null
}
