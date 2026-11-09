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
    /** The severity: `fail` is something CirCI needs that does not work, `warn` a problem to look at, `info` a note, `ok` a pass. */
    level: 'ok' | 'warn' | 'info' | 'fail'
    /** What was checked, as a name: `Database`, `Mail`, `Sites domain`. */
    label: string
    /** What was found, in a sentence or two. */
    detail: string
    /** The fact behind it, short and for a mono font: a host, a path, `2 of 3 migrations`. */
    value?: string
    /** `label`, `detail` and `value` as one sentence: what `circi admin doctor` prints. */
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

/** A finding from its parts; `message` is `label`, `detail` and `value` as one line. */
export function finding(
  input: Pick<runDoctor.Finding, 'id' | 'level' | 'label' | 'detail'> &
    Partial<Pick<runDoctor.Finding, 'value' | 'fix'>>,
): runDoctor.Finding {
  const { value, ...rest } = input
  return {
    ...rest,
    ...(value ? { value } : {}),
    message: `${input.label}: ${input.detail}${value ? ` (${value})` : ''}`,
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
    return finding({
      id: 'mail',
      level: 'info',
      label: 'Mail',
      detail: 'Not set up: sign-in codes, invitations and email notifications are off.',
      value: 'SMTP_HOST is not set',
    })
  }
  const where = `${smtp.host}:${smtp.port}`
  if (!mailer?.verify) {
    return finding({
      id: 'mail',
      level: 'info',
      label: 'Mail',
      detail: 'Configured, but not tested.',
      value: where,
    })
  }
  try {
    await mailer.verify()
    return finding({
      id: 'mail',
      level: 'ok',
      label: 'Mail',
      detail: 'Accepted a test connection.',
      value: where,
    })
  } catch (err) {
    return finding({
      id: 'mail',
      level: 'fail',
      label: 'Mail',
      detail: `Did not accept the connection: ${err instanceof Error ? err.message : String(err)}`,
      value: where,
      fix: 'Check SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER and SMTP_PASSWORD (`circi admin mail test --to <address>` sends a real test mail).',
    })
  }
}

/** The database check: reachable, and migrated as far as this version expects. */
export async function checkDatabase(
  database: NonNullable<runDoctor.Probes['database']>,
): Promise<runDoctor.Finding> {
  try {
    await database.ping()
  } catch (err) {
    return finding({
      id: 'database',
      level: 'fail',
      label: 'Database',
      detail: `Not reachable: ${err instanceof Error ? err.message : String(err)}`,
      fix: 'Check DATABASE_URL and that Postgres is running.',
    })
  }
  try {
    const { applied, available } = await database.migrations()
    if (applied < available) {
      return finding({
        id: 'database',
        level: 'fail',
        label: 'Database',
        detail: `Reachable, but only ${applied} of ${available} migrations are applied.`,
        value: `${applied} of ${available} migrations`,
        fix: 'Run `circi migrate`, or restart the server (it migrates on start unless --no-migrate is set).',
      })
    }
    if (applied > available) {
      return finding({
        id: 'database',
        level: 'fail',
        label: 'Database',
        detail: `Migrated by a newer version of CirCI: ${applied} migrations are applied, this version knows ${available}.`,
        value: `${applied} of ${available} migrations`,
        fix: 'Run the same version of CirCI everywhere, or roll the database back from a backup.',
      })
    }
    return finding({
      id: 'database',
      level: 'ok',
      label: 'Database',
      detail: 'Reachable. Migrations are current.',
      value: `${available} ${available === 1 ? 'migration' : 'migrations'}`,
    })
  } catch (err) {
    return finding({
      id: 'database',
      level: 'info',
      label: 'Database',
      detail: `Reachable, but its migrations could not be counted: ${err instanceof Error ? err.message : String(err)}`,
    })
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
    const value = `${path} · ${gb(free)} free of ${gb(total)} (${Math.round(share * 100)}%)`
    if (share < DISK_LOW_SHARE || free < DISK_LOW_BYTES) {
      return finding({
        id: 'disk',
        level: 'warn',
        label: 'Disk space',
        detail: 'The storage disk is running low.',
        value,
        fix: 'Free space (`circi admin storage gc`), lower the teams’ retention, grow the volume or move to S3 (`circi admin storage migrate`).',
      })
    }
    return finding({
      id: 'disk',
      level: 'ok',
      label: 'Disk space',
      detail: 'The storage disk has room.',
      value,
    })
  } catch (err) {
    return finding({
      id: 'disk',
      level: 'warn',
      label: 'Disk space',
      detail: `Free space could not be read: ${err instanceof Error ? err.message : String(err)}`,
      value: path,
      fix: 'Check that STORAGE_PATH exists.',
    })
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
    const where =
      config.storage?.driver === 's3'
        ? `s3 · ${config.storage.bucket}`
        : config.storage?.driver === 'fs'
          ? config.storage.path
          : storage.kind
    try {
      await storage.healthCheck()
      findings.push(
        finding({
          id: 'storage',
          level: 'ok',
          label: 'Storage',
          detail: 'Reachable and writable.',
          value: where,
        }),
      )
    } catch (err) {
      findings.push(
        finding({
          id: 'storage',
          level: 'fail',
          label: 'Storage',
          detail: `Not usable: ${err instanceof Error ? err.message : String(err)}`,
          value: where,
          fix:
            storage.kind === 's3'
              ? 'Check S3_BUCKET, S3_ENDPOINT, the credentials and that the bucket exists.'
              : 'Check that STORAGE_PATH exists and the server may write to it.',
        }),
      )
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
    findings.push(
      finding({
        id: 'public-url',
        level: 'warn',
        label: 'Dashboard address',
        detail: 'PUBLIC_URL is plain http: sign-in cookies need https.',
        value: config.publicUrl.origin,
        fix: `Put a TLS proxy such as Caddy in front and set PUBLIC_URL to https://${config.publicUrl.host}.`,
      }),
    )
  }

  const targets = new Set<string>()
  const parent = parentDomain(dashboard)
  if (parent) {
    targets.add(parent)
    targets.add(`www.${parent}`)
  }
  if (config.staticSites) targets.add(config.staticSites.host)

  for (const host of targets) {
    const isSites = config.staticSites !== undefined && host === config.staticSites.host
    const label = isSites ? 'Sites domain' : `Cookies on ${host}`
    // eslint-disable-next-line no-await-in-loop -- a handful of hosts, in order
    const res = await fetchHost(`https://${host}/`)
    if (!res) {
      findings.push(
        finding({
          id: `host:${host}`,
          level: 'info',
          label,
          detail: 'Could not be reached, so it was not checked.',
          value: host,
        }),
      )
      continue
    }
    const bad = domainCookies(res.setCookies)
    if (bad.length > 0) {
      findings.push(
        finding({
          id: `host:${host}`,
          level: 'warn',
          label,
          detail: `Sets cookies for a whole domain. Every such cookie reaches the dashboard${config.staticSites && host.endsWith(config.staticSites.host) ? ', and the sites domain must never set cookies' : ''}. Keep them host-only.`,
          value: `${host} sets ${bad.join(', ')} with a Domain attribute`,
          fix: `Make ${host} set its cookies for its own host only (no Domain attribute).`,
        }),
      )
    } else if (isSites && res.status < 400) {
      findings.push(
        finding({
          id: `host:${host}`,
          level: 'warn',
          label,
          detail: `Serves content at its apex (HTTP ${res.status}). The sites domain must serve nothing but CirCI’s sites.`,
          value: host,
          fix: `Serve nothing on ${host} itself: only the sites under its subdomains.`,
        }),
      )
    } else {
      findings.push(
        finding({
          id: `host:${host}`,
          level: 'ok',
          label,
          detail: isSites
            ? 'Serves nothing at its apex and sets no domain-wide cookies.'
            : `Sets no domain-wide cookies${res.status < 400 ? '' : ' and serves nothing'}.`,
          value: host,
        }),
      )
    }
  }

  if (!config.staticSites) {
    findings.push(
      finding({
        id: 'static-sites',
        level: 'info',
        label: 'Static sites',
        detail: 'Hosting is off.',
        value: 'STATIC_SITES_HOST is not set',
      }),
    )
  }
  if (config.staticSites) {
    findings.push(
      finding({
        id: 'custom-domains',
        level: 'info',
        label: 'Custom domains',
        detail:
          'Custom domains for sites (set in the dashboard) get their certificate from Caddy on demand: the Caddyfile needs `on_demand_tls { ask http://circi:3000/internal/tls-ask }` (deploy/Caddyfile has it). CirCI refuses a custom domain that shares a cookie scope with the dashboard.',
      }),
    )
  }
  findings.push(
    finding({
      id: 'reminder',
      level: 'info',
      label: 'Reminder',
      detail:
        'This check only sees the hosts above. Also make sure nothing else on the dashboard’s parent domain sets cookies for the whole domain, and that the sites domain hosts nothing else (docs/reference/static-sites.md).',
    }),
  )
  return findings
}

/** The line `circi admin doctor` prints for a finding, built from its fields (a fix hint goes on the next line). */
export function formatFinding(f: runDoctor.Finding): string {
  const mark = f.level === 'ok' ? '✓' : f.level === 'info' ? '·' : '⚠'
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
