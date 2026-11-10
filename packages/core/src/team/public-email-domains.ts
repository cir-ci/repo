/**
 * Public mailbox providers. A workspace cannot claim one of these as its email domain: whoever
 * signs in with an address there would join, and anyone can get an address at them.
 */
const PUBLIC_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'aol.com',
  'mail.ru',
])

/** Providers that run one address per country: `gmx.de`, `gmx.net`, `yandex.ru`, … */
const PUBLIC_FAMILIES = /^(gmx|yandex)\.[a-z]{2,}(\.[a-z]{2})?$/

/** Whether `domain` (lowercase, no `@`) is a public mailbox provider. */
export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_DOMAINS.has(domain) || PUBLIC_FAMILIES.test(domain)
}
