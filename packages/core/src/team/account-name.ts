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
