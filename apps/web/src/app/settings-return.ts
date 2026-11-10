import { currentSection, isOutsideFrame, isSettingsSection, sectionLabel } from './shell-model.ts'

/**
 * Where "Back to ..." goes out of settings: the page of the app the person was on when they
 * entered it, named for what it is ("Back to Web app", "Back to Build #148", "Back to Inbox").
 * Without one (a link straight into settings) it is the Inbox.
 */

export const FALLBACK_RETURN = '/inbox'

export interface ReturnTarget {
  path: string
  /** What the way back is called after "Back to ". */
  label: string
}

/** Whether an address is a page of the app the way back may return to. */
export function isAppPage(pathname: string): boolean {
  return !isSettingsSection(currentSection(pathname)) && !isOutsideFrame(pathname)
}

/** The target for the remembered page (path with its query), naming a team by its name when the list has it. */
export function returnTarget(
  app: string | undefined,
  teams: readonly { slug: string; name: string }[] | undefined,
): ReturnTarget {
  if (!app || !isAppPage(app.split('?')[0] ?? '')) return { path: FALLBACK_RETURN, label: 'Inbox' }
  const pathname = app.split('?')[0] ?? ''
  const parts = pathname.split('/').filter(Boolean)
  const section = currentSection(pathname)
  if (section === 'builds' || section === 'teams') {
    if (parts.length === 0) return { path: app, label: 'Teams' }
    const slug = decodeURIComponent(parts[1] ?? '')
    const number = parts[2] === 'builds' ? Number(parts[3]) : Number.NaN
    if (Number.isInteger(number)) return { path: app, label: `Build #${number}` }
    return { path: app, label: teams?.find((t) => t.slug === slug)?.name ?? slug }
  }
  const label = sectionLabel(section)
  // A page the way back can't name: back to the Inbox, as when nothing was remembered.
  return label ? { path: app, label } : { path: FALLBACK_RETURN, label: 'Inbox' }
}
