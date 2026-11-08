import type { Config } from '@circi/config'

/**
 * Best-effort checks of the things CirCI can't enforce (PLAN §7.6): cookies that other hosts on
 * the dashboard's domain or the sites domain set for a whole domain, and anything served on the
 * sites domain's apex. It only sees the hosts it asks about, so it always ends with a reminder.
 * Shared by `circi admin doctor` and the dashboard's Instance › Health page.
 */

export namespace runDoctor {
  export interface Finding {
    /** Stable name of the check (`storage`, `public-url`, `host:acme.io`…). */
    id: string
    /** The severity: `warn` is a problem, `info` a note, `ok` a pass. */
    level: 'ok' | 'warn' | 'info'
    message: string
    /** What to do about a `warn` (and sometimes an `info`). */
    fix?: string
  }
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

export type Fetcher = (url: string) => Promise<{ status: number; setCookies: string[] } | undefined>

export async function runDoctor(
  config: Pick<Config, 'publicUrl' | 'staticSites'>,
  fetchHost: Fetcher,
  storage?: { kind: string; healthCheck(): Promise<void> },
): Promise<runDoctor.Finding[]> {
  const findings: runDoctor.Finding[] = []
  if (storage) {
    try {
      await storage.healthCheck()
      findings.push({
        id: 'storage',
        level: 'ok',
        message: `Storage (${storage.kind}) is reachable and writable.`,
      })
    } catch (err) {
      findings.push({
        id: 'storage',
        level: 'warn',
        message: `Storage (${storage.kind}) is not usable: ${err instanceof Error ? err.message : String(err)}`,
        fix:
          storage.kind === 's3'
            ? 'Check S3_BUCKET, S3_ENDPOINT, the credentials and that the bucket exists.'
            : 'Check that STORAGE_PATH exists and the server may write to it.',
      })
    }
  }
  const dashboard = config.publicUrl.hostname
  if (config.publicUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(dashboard)) {
    findings.push({
      id: 'public-url',
      level: 'warn',
      message: `PUBLIC_URL is plain http (${config.publicUrl.origin}): sign-in cookies need https.`,
      fix: `Put a TLS proxy such as Caddy in front and set PUBLIC_URL to https://${config.publicUrl.host}.`,
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
        id: `host:${host}`,
        level: 'info',
        message: `${host}: could not be reached, so it wasn't checked.`,
      })
      continue
    }
    const bad = domainCookies(res.setCookies)
    if (bad.length > 0) {
      findings.push({
        id: `host:${host}`,
        level: 'warn',
        fix: `Make ${host} set its cookies for its own host only (no Domain attribute).`,
        message: `${host} sets cookies for a whole domain (${bad.join(', ')}). Every such cookie reaches the dashboard${config.staticSites && host.endsWith(config.staticSites.host) ? ', and the sites domain must never set cookies' : ''}. Keep them host-only.`,
      })
    } else if (config.staticSites && host === config.staticSites.host && res.status < 400) {
      findings.push({
        id: `host:${host}`,
        level: 'warn',
        fix: `Serve nothing on ${host} itself: only the sites under its subdomains.`,
        message: `${host} (the sites domain's apex) serves content (HTTP ${res.status}). The sites domain must serve nothing but CirCI's sites.`,
      })
    } else {
      findings.push({
        id: `host:${host}`,
        level: 'ok',
        message: `${host}: no domain-wide cookies${res.status < 400 ? '' : ' and nothing served'}.`,
      })
    }
  }

  if (!config.staticSites) {
    findings.push({
      id: 'static-sites',
      level: 'info',
      message: 'Static site hosting is off (STATIC_SITES_HOST is not set).',
    })
  }
  findings.push({
    id: 'reminder',
    level: 'info',
    message:
      'This check only sees the hosts above. Also make sure nothing else on the dashboard’s parent domain sets cookies for the whole domain, and that the sites domain hosts nothing else (docs/static-sites.md).',
  })
  return findings
}

/** The line `circi admin doctor` prints for a finding (a fix hint goes on the next line). */
export function formatFinding(f: runDoctor.Finding): string {
  const mark = f.level === 'ok' ? '✓' : f.level === 'warn' ? '⚠' : '·'
  return `${mark} ${f.message}${f.fix ? `\n    fix: ${f.fix}` : ''}`
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
