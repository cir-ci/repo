import type { SessionUser } from '#lib/auth-client.ts'

/**
 * The last signed-in person, kept in this browser (not a secret: the session itself is an httpOnly
 * cookie). It lets the shell draw the app at once from the stored query cache and check the
 * session afterwards (see `Shell.tsx`); signing out, a 401 or another person signing in removes it.
 */
export const SESSION_HINT_KEY = 'circi-session-hint'
/**
 * How long after the last server check the hint still lets the app draw before the session is
 * verified. Older than this, the shell shows the usual checking/sign-in path instead, so a
 * browser profile left alone for days never opens straight onto someone's stored data. A check
 * that can't reach the server (offline) still falls back to the hint, but only once the hint
 * was fresh at load (see `sessionState`): offline use right after a visit keeps working.
 */
export const HINT_MAX_AGE_MS = 12 * 3600_000

type HintStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** The browser's storage, or undefined where there is none (Node, a blocked profile). */
function browserStorage(): HintStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

export function readSessionHint(
  storage: HintStorage | undefined = browserStorage(),
): SessionUser | null {
  try {
    const text = storage?.getItem(SESSION_HINT_KEY)
    if (!text) return null
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null) return null
    const { id, name, email, image } = { id: null, name: null, email: null, image: null, ...value }
    if (typeof id !== 'string' || typeof name !== 'string' || typeof email !== 'string') return null
    return { id, name, email, image: typeof image === 'string' ? image : null }
  } catch {
    return null
  }
}

/**
 * The remembered person only while the server last confirmed them within `HINT_MAX_AGE_MS`;
 * a hint with no (or a future) time counts as old. Use `readSessionHint` for "who was here" (to
 * decide whether to drop their data), this for "may the app draw before the check".
 */
export function readFreshSessionHint(
  storage: HintStorage | undefined = browserStorage(),
  now = Date.now(),
): SessionUser | null {
  const user = readSessionHint(storage)
  if (!user) return null
  try {
    const value: unknown = JSON.parse(storage?.getItem(SESSION_HINT_KEY) ?? 'null')
    const at =
      typeof value === 'object' && value !== null && 'verifiedAt' in value
        ? value.verifiedAt
        : undefined
    return typeof at === 'number' && at <= now && now - at <= HINT_MAX_AGE_MS ? user : null
  } catch {
    return null
  }
}

export function writeSessionHint(
  user: SessionUser,
  storage: HintStorage | undefined = browserStorage(),
  now = Date.now(),
): void {
  try {
    storage?.setItem(SESSION_HINT_KEY, JSON.stringify({ ...user, verifiedAt: now }))
  } catch {
    // Storage full or blocked: the next visit just waits for the session check.
  }
}

export function clearSessionHint(storage: HintStorage | undefined = browserStorage()): void {
  try {
    storage?.removeItem(SESSION_HINT_KEY)
  } catch {
    // Nothing to forget where nothing can be stored.
  }
}

/** What better-auth's `useSession` says, as far as the shell cares. */
export interface SessionReading {
  isPending: boolean
  user: SessionUser | null
  /** The check's own error: a `status` for a reply, none (or 0) when the request never got one. */
  error?: { status?: number } | null | undefined
}

export type SessionState =
  | { kind: 'checking' }
  | { kind: 'signed-out' }
  /** `verified` is false while the person shown is only the remembered one. */
  | { kind: 'signed-in'; user: SessionUser; verified: boolean }

/**
 * What to draw. Pending with a remembered person: the app, now, from the stored cache. Answered
 * with nobody (or a 401/403): signed out. A check that never reached the server (offline, a 5xx)
 * keeps the remembered person's app rather than the sign-in page: the stored data is still the
 * best there is, and the next request that gets a 401 ends the session.
 */
export function sessionState(reading: SessionReading, hint: SessionUser | null): SessionState {
  if (reading.user) return { kind: 'signed-in', user: reading.user, verified: !reading.isPending }
  if (reading.isPending)
    return hint ? { kind: 'signed-in', user: hint, verified: false } : { kind: 'checking' }
  const status = reading.error?.status
  const unreachable =
    reading.error !== null &&
    reading.error !== undefined &&
    (status === undefined || status === 0 || status >= 500)
  if (unreachable && hint) return { kind: 'signed-in', user: hint, verified: false }
  return { kind: 'signed-out' }
}

/** What the shell does about the stored cache once the state is known. */
export type SessionSync = 'none' | 'forget' | 'switch' | 'remember'

/**
 * `forget`: the session ended (drop the stored cache, the in-memory data and the hint). `switch`:
 * a different person than the remembered one (the same, then `remember`). `remember`: write the
 * hint and keep storing the cache. Only a verified session changes anything.
 */
export function sessionSync(state: SessionState, hint: SessionUser | null): SessionSync {
  if (state.kind === 'signed-out') return 'forget'
  if (state.kind !== 'signed-in' || !state.verified) return 'none'
  if (hint && hint.id !== state.user.id) return 'switch'
  return 'remember'
}
