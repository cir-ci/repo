/**
 * better-auth reports a malformed body as `[body.email] Invalid input: expected string, received
 * undefined` (several problems joined with "; "). This turns that text into the app routes' own
 * shape: one human sentence, and a message per field.
 */

const LABELS: Record<string, string> = {
  organizationId: 'Workspace',
  organizationSlug: 'Workspace',
  memberIdOrEmail: 'Member',
  invitationId: 'Invitation',
  otp: 'Code',
}

function labelOf(key: string): string {
  const known = LABELS[key]
  if (known) return known
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function sentence(label: string, text: string): string {
  if (/received (undefined|null)\b/.test(text)) return `${label} is required`
  if (/^Invalid email/i.test(text)) return `${label} must be a valid email address`
  if (/^Invalid (url|URL)/.test(text)) return `${label} must be a valid web address`
  const small = /^Too small: expected string to have >=(\d+) characters?/.exec(text)
  if (small) {
    const min = Number(small[1])
    return min <= 1 ? `${label} can't be blank` : `${label} must be at least ${min} characters`
  }
  const big = /^Too big: expected string to have <=(\d+) characters?/.exec(text)
  if (big) return `${label} must be ${big[1]} characters or fewer`
  if (text.startsWith('Invalid option')) return `${label} isn't one of the allowed values`
  return `${label} isn't valid`
}

export interface AuthValidationProblem {
  /** All the sentences, joined. */
  error: string
  /** One sentence per field (the name as the request spells it). */
  fields: Record<string, string>
}

/** The readable form of better-auth's validation message, or undefined when it isn't one. */
export function describeAuthValidation(raw: string): AuthValidationProblem | undefined {
  const parts = raw.split(/;\s*(?=\[(?:body|query)[.\]])/)
  const fields: Record<string, string> = {}
  const sentences: string[] = []
  for (const part of parts) {
    const m = /^\[(body|query)(?:\.([^\]]+))?\]\s*(.*)$/s.exec(part.trim())
    if (!m) return undefined
    const key = m[2]
    const text = m[3] ?? ''
    const line = key
      ? sentence(labelOf(key.split('.').at(-1) ?? key), text)
      : 'The request needs a valid body'
    fields[key ?? 'body'] ??= line
    sentences.push(line)
  }
  if (sentences.length === 0) return undefined
  return { error: sentences.join('; '), fields }
}
