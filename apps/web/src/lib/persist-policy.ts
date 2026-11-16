import type { PersistedClient } from '@tanstack/query-persist-client-core'
import type { DehydratedState } from '@tanstack/react-query'

type DehydratedQuery = DehydratedState['queries'][number]

/**
 * What of the query cache is kept on this device between visits (see `query-persist.ts`). The
 * rule is an allowlist by the first part of a query key: a key this file doesn't name is never
 * stored, so a new query is safe by default, and `test/lib/persist-policy.test.ts` fails until
 * every key in `query-keys.ts` is put on one list or the other.
 */

/** Stored data older than this is dropped on the next read and the next write. */
export const PERSIST_MAX_AGE = 24 * 60 * 60 * 1000
/** The most the stored cache may weigh (characters of JSON), oldest data dropped first. */
export const PERSIST_MAX_CHARS = 4_000_000

/** Read models of the dashboard: lists, pages and settings with nothing secret in them. */
const PERSISTED = new Set([
  'projects',
  'project',
  'settings',
  'project-members',
  'ignore-regions',
  'flaky',
  'baselines',
  'project-sites',
  'rules',
  'triage',
  'snapshot-history',
  'build',
  'comments',
  'activity',
  'issues',
  'workspace',
  'workspace-general',
  'member-projects',
  'workspace-settings',
  'workspace-domains',
  'workspace-builds',
  'views',
  'sidebar',
  'insights',
  'capabilities',
  'reviews',
  'inbox',
  'notification-preferences',
])

/**
 * Never stored, with the reason: secrets and one-time values (`token`, `integrations` carries a
 * webhook secret, `setup`), account and security state (`sessions`, `linked-accounts`,
 * `auth-methods`, `email-change`, `push-devices`, `workspace-sso`, `workspace-auth`,
 * `workspace-storage`, `member-sign-in`, every `instance-*` admin page), and typed-ahead lookups
 * that are worthless the next day (`search`, `build-suggestions`, `branches`, `github-import`).
 */
const EXCLUDED = new Set([
  'token',
  'integrations',
  'setup',
  'sessions',
  'linked-accounts',
  'auth-methods',
  'email-change',
  'push-devices',
  'workspace-sso',
  'workspace-auth',
  'workspace-storage',
  'member-sign-in',
  'search',
  'build-suggestions',
  'branches',
  'github-import',
])

/** The first part of a query key as text, or undefined for a key that doesn't start with one. */
function head(queryKey: readonly unknown[]): string | undefined {
  const first = queryKey[0]
  return typeof first === 'string' ? first : undefined
}

/** True when this key is on the allowlist (and not an `instance-*` page). */
export function isPersistable(queryKey: readonly unknown[]): boolean {
  const name = head(queryKey)
  return name !== undefined && PERSISTED.has(name) && !EXCLUDED.has(name)
}

/** True when this key is deliberately kept out of the stored cache. */
export function isExcluded(queryKey: readonly unknown[]): boolean {
  const name = head(queryKey)
  return name !== undefined && (EXCLUDED.has(name) || name.startsWith('instance-'))
}

export interface PruneOptions {
  now: number
  maxAge?: number
  maxChars?: number
}

/**
 * What goes to storage (and what comes back from it): only allowlisted queries not older than
 * `maxAge`, newest first until `maxChars` of JSON is used, and no mutations (an unfinished
 * change is never replayed on another day). Run on both sides, so an older build's wider list
 * can't smuggle anything back in.
 */
export function pruneForStorage(client: PersistedClient, options: PruneOptions): PersistedClient {
  const { now, maxAge = PERSIST_MAX_AGE, maxChars = PERSIST_MAX_CHARS } = options
  const candidates = client.clientState.queries
    .filter((q) => isPersistable(q.queryKey) && now - q.state.dataUpdatedAt <= maxAge)
    .toSorted((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
  const kept: DehydratedQuery[] = []
  let used = 0
  for (const query of candidates) {
    const size = JSON.stringify(query).length
    if (used + size > maxChars) continue
    used += size
    kept.push(query)
  }
  return { ...client, clientState: { mutations: [], queries: kept } }
}

/** A stored cache read back from text, or undefined when it isn't one (corrupt, or from another format). */
export function parsePersisted(text: string): PersistedClient | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  if (!('timestamp' in value) || typeof value.timestamp !== 'number') return undefined
  if (!('buster' in value) || typeof value.buster !== 'string') return undefined
  if (!('clientState' in value) || typeof value.clientState !== 'object') return undefined
  const state = value.clientState
  if (state === null || !('queries' in state) || !Array.isArray(state.queries)) return undefined
  // Each query is the library's own shape, written by `dehydrate`; one that doesn't look like it
  // (a hand-edited store, another format) is dropped, and the buster and `pruneForStorage` (the
  // allowlist) stand between an older build's data and the cache.
  const queries: DehydratedQuery[] = state.queries.filter(isDehydratedQuery)
  return {
    timestamp: value.timestamp,
    buster: value.buster,
    clientState: { mutations: [], queries },
  }
}

function isDehydratedQuery(value: unknown): value is DehydratedQuery {
  if (typeof value !== 'object' || value === null) return false
  if (!('queryKey' in value) || !Array.isArray(value.queryKey)) return false
  if (!('state' in value) || typeof value.state !== 'object' || value.state === null) return false
  return 'dataUpdatedAt' in value.state && typeof value.state.dataUpdatedAt === 'number'
}
