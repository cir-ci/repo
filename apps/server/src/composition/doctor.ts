import { statfs } from 'node:fs/promises'

import type { Config } from '@circi/config'

/**
 * Best-effort checks of the things CirCI can't enforce (PLAN §7.6): cookies that other hosts on
 * the dashboard's domain or the sites domain set for a whole domain, and anything served on the
 * sites domain's apex. It only sees the hosts it asks about, so it always ends with a reminder.
 * Shared by `circi admin doctor` and the dashboard's Instance › Health page. With `probes` it also
 * checks the instance itself: the database (reachable, migrated), mail (SMTP accepts a login,
 * nothing is sent) and, for local storage, free disk space.
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

  /** What the checks that need more than the configuration ask of the running instance. */
  export interface Probes {
    /** The mailer; its `verify` connects to the SMTP server without sending. */
    mailer?: { verify?(): Promise<void> }
    /** The database: a ping and how many migrations are applied against how many ship. */
    database?: {
      ping(): Promise<void>
      migrations(): Promise<{ applied: number; available: number }>
    }
    /** Free space at a path; default `fs.statfs`. */
    diskSpace?: (path: string) => Promise<{ free: number; total: number }>
  }
}

/** Below this share of the disk free, or this many bytes, the storage disk is called low. */
export const DISK_LOW_SHARE = 0.1
export const DISK_LOW_BYTES = 2 * 1024 ** 3

const GB = 1024 ** 3
const gb = (bytes: number) => `${(bytes / GB).toFixed(bytes < 10 * GB ? 1 : 0)} GB`

/** Free and total bytes at `path` (what a non-root process may use). */
export async function statDisk(path: string): Promise<{ free: number; total: number }> {
  const s = await statfs(path)
  return { free: s.bavail * s.bsize, total: s.blocks * s.bsize }
}

/** The mail check: connect to the SMTP server and log in, without sending anything. */
export async function checkMail(
  config: Pick<Config, 'smtp'>,
  mailer: runDoctor.Probes['mailer'],
): Promise<runDoctor.Finding> {
  const { smtp } = config
  if (!smtp) {
    return {
      id: 'mail',
      level: 'info',
      message:
        'Mail is not set up (SMTP_HOST is not set): sign-in codes, invitations and email notifications are off.',
    }
  }
  const where = `${smtp.host}:${smtp.port}`
  if (!mailer?.verify) {
    return {
      id: 'mail',
      level: 'info',
      message: `Mail (${where}) is configured but was not tested.`,
    }
  }
  try {
    await mailer.verify()
    return { id: 'mail', level: 'ok', message: `Mail server ${where} accepted the connection.` }
  } catch (err) {
    return {
      id: 'mail',
      level: 'warn',
      message: `Mail server ${where} did not accept the connection: ${err instanceof Error ? err.message : String(err)}`,
      fix: 'Check SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER and SMTP_PASSWORD (`circi admin mail test --to <address>` sends a real test mail).',
    }
  }
}

/** The database check: reachable, and migrated as far as this version expects. */
export async function checkDatabase(
  database: NonNullable<runDoctor.Probes['database']>,
): Promise<runDoctor.Finding> {
  try {
    await database.ping()
  } catch (err) {
    return {
      id: 'database',
      level: 'warn',
      message: `The database is not reachable: ${err instanceof Error ? err.message : String(err)}`,
      fix: 'Check DATABASE_URL and that Postgres is running.',
    }
  }
  try {
    const { applied, available } = await database.migrations()
    if (applied < available) {
      return {
        id: 'database',
        level: 'warn',
        message: `The database is reachable, but only ${applied} of ${available} migrations are applied.`,
        fix: 'Run `circi migrate`, or restart the server (it migrates on start unless --no-migrate is set).',
      }
    }
    if (applied > available) {
      return {
        id: 'database',
        level: 'warn',
        message: `The database has ${applied} migrations applied, but this version of CirCI knows ${available}: it was migrated by a newer version.`,
        fix: 'Run the same version of CirCI everywhere, or roll the database back from a backup.',
      }
    }
    return {
      id: 'database',
      level: 'ok',
      message: `The database is reachable and all ${available} migrations are applied.`,
    }
  } catch (err) {
    return {
      id: 'database',
      level: 'info',
      message: `The database is reachable, but its migrations could not be counted: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/** The disk check for local storage: warns below 10% free or 2 GB. */
export async function checkDisk(
  path: string,
  diskSpace: NonNullable<runDoctor.Probes['diskSpace']>,
): Promise<runDoctor.Finding> {
  try {
    const { free, total } = await diskSpace(path)
    const share = total > 0 ? free / total : 0
    const text = `${gb(free)} free of ${gb(total)} (${Math.round(share * 100)}%) at ${path}`
    if (share < DISK_LOW_SHARE || free < DISK_LOW_BYTES) {
      return {
        id: 'disk',
        level: 'warn',
        message: `Storage disk is running low: ${text}.`,
        fix: 'Free space (`circi admin storage gc`), lower the teams’ retention, grow the volume or move to S3 (`circi admin storage migrate`).',
      }
    }
    return { id: 'disk', level: 'ok', message: `Storage disk has room: ${text}.` }
  } catch (err) {
    return {
      id: 'disk',
      level: 'warn',
      message: `Free space at ${path} could not be read: ${err instanceof Error ? err.message : String(err)}`,
      fix: 'Check that STORAGE_PATH exists.',
    }
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
  config: Pick<Config, 'publicUrl' | 'staticSites'> & Partial<Pick<Config, 'smtp' | 'storage'>>,
  fetchHost: Fetcher,
  storage?: { kind: string; healthCheck(): Promise<void> },
  probes?: runDoctor.Probes,
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
  // The checks that ask the running instance (disk, database, mail) run when probes are given.
  if (probes) {
    if (config.storage?.driver === 'fs') {
      findings.push(await checkDisk(config.storage.path, probes.diskSpace ?? statDisk))
    }
    if (probes.database) findings.push(await checkDatabase(probes.database))
    findings.push(await checkMail({ smtp: config.smtp }, probes.mailer))
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
  if (config.staticSites) {
    findings.push({
      id: 'custom-domains',
      level: 'info',
      message:
        'Custom domains for sites (set in the dashboard) get their certificate from Caddy on demand: the Caddyfile needs `on_demand_tls { ask http://circi:3000/internal/tls-ask }` (deploy/Caddyfile has it). CirCI refuses a custom domain that shares a cookie scope with the dashboard.',
    })
  }
  findings.push({
    id: 'reminder',
    level: 'info',
    message:
      'This check only sees the hosts above. Also make sure nothing else on the dashboard’s parent domain sets cookies for the whole domain, and that the sites domain hosts nothing else (docs/reference/static-sites.md).',
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
