/** The longest account name accepted, in characters. */
export const ACCOUNT_NAME_MAX = 100

/**
 * The problem with an account (display) name, or undefined when it is fine: after trimming it
 * must be 1 to `ACCOUNT_NAME_MAX` characters. Markup is not stripped here (the dashboard never
 * renders names as HTML).
 */
export function accountNameProblem(name: string): string | undefined {
  const trimmed = name.trim()
  if (trimmed.length === 0) return 'Enter a name.'
  if (Array.from(trimmed).length > ACCOUNT_NAME_MAX) {
    return `Use ${ACCOUNT_NAME_MAX} characters or fewer for a name.`
  }
  return undefined
}

/** The longest profile picture address accepted, in characters. */
export const ACCOUNT_IMAGE_MAX = 2048

/**
 * The problem with an account's picture address, or undefined when it is fine: empty (no
 * picture), an http(s) URL, or a path on this server (`/api/…`), up to `ACCOUNT_IMAGE_MAX`
 * characters. Anything else (`javascript:`, `data:`, …) is refused.
 */
export function accountImageProblem(image: string): string | undefined {
  if (image === '') return undefined
  if (image.length > ACCOUNT_IMAGE_MAX) {
    return `A picture address can be at most ${ACCOUNT_IMAGE_MAX} characters.`
  }
  if (/^\/api\/[^\s]*$/.test(image)) return undefined
  try {
    const url = new URL(image)
    if ((url.protocol === 'https:' || url.protocol === 'http:') && url.hostname !== '') {
      return undefined
    }
  } catch {
    // Not a URL: falls through.
  }
  return 'A picture address must be an http or https web address.'
}
