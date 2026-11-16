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

/** What the way back knows of a project: its name, and how many hosted sites it has (Sites is only a page while it has some). */
export interface ReturnProject {
  slug: string
  name: string
  siteCount?: number
}

/** The project an app address belongs to, in the list; undefined when the address is not a project's or the list is not loaded. */
function projectOf(pathname: string, projects: readonly ReturnProject[] | undefined) {
  const [, slug] = pathname.split('/').filter(Boolean)
  return slug === undefined ? undefined : projects?.find((p) => p.slug === decodeURIComponent(slug))
}

/**
 * Whether an address is a page of the app the way back may return to: not settings, not outside the
 * frame, and not the Sites of a project that has none (the sidebar doesn't list it either; the
 * page only explains that hosting is off).
 */
export function isAppPage(pathname: string, projects?: readonly ReturnProject[]): boolean {
  const section = currentSection(pathname)
  if (isSettingsSection(section) || isOutsideFrame(pathname)) return false
  return !(section === 'sites' && projectOf(pathname, projects)?.siteCount === 0)
}

/** The target for the remembered page (path with its query), naming a project by its name when the list has it. */
export function returnTarget(
  app: string | undefined,
  projects: readonly ReturnProject[] | undefined,
): ReturnTarget {
  const pathname = app?.split('?')[0] ?? ''
  // Nothing remembered, or a page that isn't a destination (any more): the Inbox. The Sites of a
  // project without sites goes to the project itself.
  if (!app || !isAppPage(pathname, projects)) {
    const project = projectOf(pathname, projects)
    const workspace = pathname.split('/')[1]
    if (app && currentSection(pathname) === 'sites' && project)
      return {
        path: `/${workspace}/${project.slug}`,
        label: project.name,
      }
    return { path: FALLBACK_RETURN, label: 'Inbox' }
  }
  const parts = pathname.split('/').filter(Boolean)
  const section = currentSection(pathname)
  if (section === 'builds' || section === 'projects') {
    if (parts.length === 0) return { path: app, label: 'Projects' }
    const slug = decodeURIComponent(parts[1] ?? '')
    const number = parts[2] === 'builds' ? Number(parts[3]) : Number.NaN
    if (Number.isInteger(number)) return { path: app, label: `Build #${number}` }
    return { path: app, label: projects?.find((t) => t.slug === slug)?.name ?? slug }
  }
  const label = sectionLabel(section)
  // A page the way back can't name: back to the Inbox, as when nothing was remembered.
  return label ? { path: app, label } : { path: FALLBACK_RETURN, label: 'Inbox' }
}
