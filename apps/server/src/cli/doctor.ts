import type { Config } from '@circi/config'

/**
 * Best-effort checks of the things CirCI can't enforce (PLAN §7.6): cookies that other hosts on
 * the dashboard's domain or the sites domain set for a whole domain, and anything served on the
 * sites domain's apex. It only sees the hosts it asks about, so it always ends with a reminder.
 */

export interface Finding {
  level: 'ok' | 'warn' | 'info'
  message: string
}

/** The parent domain of a host (`ci.acme.io` → `acme.io`), when it has one worth checking. */
export function parentDomain(hostname: string): string | undefined {
  const parts = hostname.split('.')
  return parts.length >= 3 ? parts.slice(1).join('.') : undefined
}

/** `Set-Cookie` headers that scope a cookie to a whole domain (`Domain=…`). */
export function domainCookies(setCookies: readonly string[]): string[] {
  return setCookies.filter((c) => /;\s*domain=/i.test(c)).map((c) => c.split('=')[0] ?? c)
}

type Fetcher = (url: string) => Promise<{ status: number; setCookies: string[] } | undefined>

export async function runDoctor(
  config: Pick<Config, 'publicUrl' | 'staticSites'>,
  fetchHost: Fetcher,
  storage?: { kind: string; healthCheck(): Promise<void> },
): Promise<Finding[]> {
  const findings: Finding[] = []
  if (storage) {
    try {
      await storage.healthCheck()
      findings.push({
        level: 'ok',
        message: `Storage (${storage.kind}) is reachable and writable.`,
      })
    } catch (err) {
      findings.push({
        level: 'warn',
        message: `Storage (${storage.kind}) is not usable: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }
  const dashboard = config.publicUrl.hostname
  if (config.publicUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(dashboard)) {
    findings.push({
      level: 'warn',
      message: `PUBLIC_URL is plain http (${config.publicUrl.origin}): sign-in cookies need https.`,
    })
  }

  const targets = new Set<string>()
  const parent = parentDomain(dashboard)
  if (parent) {
    targets.add(parent)
    targets.add(`www.${parent}`)
  }
  if (config.staticSites) targets.add(config.staticSites.host)

  for (const host of targets) {
    // eslint-disable-next-line no-await-in-loop -- a handful of hosts, in order
    const res = await fetchHost(`https://${host}/`)
    if (!res) {
      findings.push({
        level: 'info',
        message: `${host}: could not be reached, so it wasn't checked.`,
      })
      continue
    }
    const bad = domainCookies(res.setCookies)
    if (bad.length > 0) {
      findings.push({
        level: 'warn',
        message: `${host} sets cookies for a whole domain (${bad.join(', ')}). Every such cookie reaches the dashboard${config.staticSites && host.endsWith(config.staticSites.host) ? ', and the sites domain must never set cookies' : ''}. Keep them host-only.`,
      })
    } else if (config.staticSites && host === config.staticSites.host && res.status < 400) {
      findings.push({
        level: 'warn',
        message: `${host} (the sites domain's apex) serves content (HTTP ${res.status}). The sites domain must serve nothing but CirCI's sites.`,
      })
    } else {
      findings.push({
        level: 'ok',
        message: `${host}: no domain-wide cookies${res.status < 400 ? '' : ' and nothing served'}.`,
      })
    }
  }

  if (!config.staticSites) {
    findings.push({
      level: 'info',
      message: 'Static site hosting is off (STATIC_SITES_HOST is not set).',
    })
  }
  findings.push({
    level: 'info',
    message:
      'This check only sees the hosts above. Also make sure nothing else on the dashboard’s parent domain sets cookies for the whole domain, and that the sites domain hosts nothing else (docs/static-sites.md).',
  })
  return findings
}

/** The real thing: a plain GET that doesn't follow redirects and reads `Set-Cookie`. */
export const httpFetcher: Fetcher = async (url) => {
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8_000) })
    return { status: res.status, setCookies: res.headers.getSetCookie() }
  } catch {
    return undefined
  }
}
