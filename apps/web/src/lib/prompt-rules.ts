/**
 * When the dashboard offers to install itself and to turn on notifications. Pure rules, so the
 * timing is testable without a page: the store keeps the counts, the components ask here.
 *
 * Both offers share one rule for "Not now": it hides the offer for 14 days, and after the third
 * "Not now" it stays hidden. Neither is ever shown on a first visit, or as a pop-up.
 */

/** How long "Not now" hides an offer. */
export const NOT_NOW_DAYS = 14
/** After this many "Not now" answers the offer is not made again. */
export const MAX_NOT_NOW = 3
/** The visit from which the install offer may show (never the first). */
export const INSTALL_AFTER_VISITS = 2

const DAY_MS = 24 * 60 * 60 * 1000

/** How often an offer was put off, and when last (epoch ms). */
export interface Dismissals {
  count: number
  lastAt: number | null
}

export const NO_DISMISSALS: Dismissals = { count: 0, lastAt: null }

/** The state after one more "Not now" at `now`. */
export function putOff(d: Dismissals, now: number): Dismissals {
  return { count: d.count + 1, lastAt: now }
}

/** Whether "Not now" still hides the offer at `now`. */
export function isPutOff(d: Dismissals, now: number): boolean {
  if (d.count >= MAX_NOT_NOW) return true
  return d.lastAt !== null && now - d.lastAt < NOT_NOW_DAYS * DAY_MS
}

export interface InstallOfferInput {
  /** Sessions in which the dashboard was opened on this device. */
  visits: number
  /** Whether the person has approved something here. */
  approved: boolean
  /** Already running as an installed app. */
  installed: boolean
  /** The browser can install it: it offered a prompt, or it is Safari on an iPhone (the steps sheet). */
  canInstall: boolean
  dismissals: Dismissals
  now: number
}

/** The banner on Inbox: after the second visit or the first approval. */
export function shouldOfferInstall(input: InstallOfferInput): boolean {
  if (input.installed || !input.canInstall) return false
  if (isPutOff(input.dismissals, input.now)) return false
  return input.visits >= INSTALL_AFTER_VISITS || input.approved
}

/** The browser's answer to "may this site notify?", or that it has no push at all. */
export type PushPermission = 'default' | 'granted' | 'denied' | 'unsupported'

export interface PushOfferInput {
  permission: PushPermission
  /** This browser is already subscribed. */
  subscribed: boolean
  /** The person has a review waiting on Reviews, or has approved something. */
  triggered: boolean
  /** An iPhone that has not been added to the Home Screen can't push: the install offer covers it. */
  needsInstall: boolean
  dismissals: Dismissals
  now: number
}

/** The card on Reviews: in context, after a review landed there or after the first approval. */
export function shouldAskForPush(input: PushOfferInput): boolean {
  if (input.permission !== 'default' || input.subscribed || input.needsInstall) return false
  if (!input.triggered) return false
  return !isPutOff(input.dismissals, input.now)
}

/** What the browser keeps between visits. */
export interface StoredPrompts {
  visits: number
  approved: boolean
  install: Dismissals
  push: Dismissals
}

export const EMPTY_PROMPTS: StoredPrompts = {
  visits: 0,
  approved: false,
  install: NO_DISMISSALS,
  push: NO_DISMISSALS,
}

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
const dismissals = (v: unknown): Dismissals => {
  if (typeof v !== 'object' || v === null) return NO_DISMISSALS
  const lastAt = 'lastAt' in v && typeof v.lastAt === 'number' ? v.lastAt : null
  return { count: 'count' in v ? count(v.count) : 0, lastAt }
}

/** Reads what was stored; anything missing or malformed counts as nothing happened yet. */
export function parseStoredPrompts(raw: string | null): StoredPrompts {
  if (!raw) return EMPTY_PROMPTS
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return EMPTY_PROMPTS
    return {
      visits: 'visits' in value ? count(value.visits) : 0,
      approved: 'approved' in value && value.approved === true,
      install: 'install' in value ? dismissals(value.install) : NO_DISMISSALS,
      push: 'push' in value ? dismissals(value.push) : NO_DISMISSALS,
    }
  } catch {
    return EMPTY_PROMPTS
  }
}

/**
 * Whether a request that succeeded was an approval of a build or of screenshots: the first one
 * makes the install and notification offers appropriate (a person who approves comes back).
 */
export function isApprovalRequest(method: string, path: string, body: unknown): boolean {
  if (method !== 'POST' || !/\/(snapshots\/)?review$/.test(path.split('?')[0] ?? '')) return false
  if (typeof body !== 'string') return false
  try {
    const parsed: unknown = JSON.parse(body)
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      (('state' in parsed && parsed.state === 'approved') ||
        ('decision' in parsed && parsed.decision === 'approved'))
    )
  } catch {
    return false
  }
}
