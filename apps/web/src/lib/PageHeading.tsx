import { Breadcrumbs, PanelHeader, visuallyHidden } from '@circi/ui'
import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from 'react'

import { NavToggleButton } from '#app/NavToggle.tsx'
import { PhoneEnd } from '#app/PhoneHeader.tsx'
import { PhoneProjectTabs, usePhoneProjectTabs } from '#app/PhoneProjectTabs.tsx'

import type { Crumb as CrumbType } from './crumbs.ts'
import { useClientLink } from './use-client-link.ts'
import { usePhone } from './use-phone.ts'

import styles from './PageHeading.module.css'

export {
  crumbsFor,
  settingsCrumbsFor,
  projectBuildsCrumb,
  projectCrumb,
  workspaceCrumb,
} from './crumbs.ts'

const NO_CRUMBS: readonly PageHeading.Crumb[] = []

/**
 * THE page-structure rule, for every page in the app: the current breadcrumb is the page's
 * `<h1>`; a page without a breadcrumb has a visually hidden `<h1>` (`PageTitle`).
 *
 * `PageHeading` is the header bar of a page: its ancestors as links (`crumbs`), then `title`,
 * the current page, as the `<h1>` (plain text, no link). Pass `actions` for the page's buttons.
 *
 *   <PageHeading crumbs={crumbsFor({ workspace: ws, project })} title="Webhooks" />
 *
 * Build the crumbs with `crumbsFor` (see `crumbs.ts`: display names, the workspace crumb goes to
 * the Inbox, the project crumb to its Builds page). A top-level page (Inbox, Projects) has no ancestors:
 * `<PageHeading title="Inbox" />`. Keep this API stable: other pages depend on it.
 */
export function PageHeading({
  crumbs = NO_CRUMBS,
  title,
  actions,
  after,
  afterOwnRow = false,
  headingInPage,
  find,
  status,
}: PageHeading.Props) {
  const clientLink = useClientLink()
  const phone = usePhone()
  const statusRef = useRef<HTMLDivElement>(null)
  const statusRow = useStatusRow(statusRef, Boolean(status))
  return (
    <PanelHeader
      below={phone ? <PhoneFindRow find={find} /> : null}
      actions={
        <>
          {phone ? null : find}
          {actions}
          <PhoneEnd />
        </>
      }
    >
      <NavToggleButton />
      <Breadcrumbs
        {...(status ? { className: styles.shrinkCrumbs } : {})}
        currentIsHeading={!headingInPage}
        items={[
          ...crumbs.map((crumb) => ({
            label: crumb.label,
            ...(crumb.link ? clientLink(crumb.link) : {}),
            ...(crumb.link && crumb.tooltip ? { tooltip: crumb.tooltip } : {}),
          })),
          { label: title },
        ]}
      />
      {after ? (
        // Beside the title; with `afterOwnRow`, on a phone a row of its own under it.
        <div
          className={status ? `${styles.after} ${styles.shrinkAfter}` : styles.after}
          data-header-row={afterOwnRow ? '' : undefined}
        >
          {after}
        </div>
      ) : null}
      {status ? (
        // Beside the buttons while the whole line fits; otherwise a line of its own, on the left
        // under the title. The buttons keep the title's line either way (the crumbs give way).
        <div
          ref={statusRef}
          className={styles.status}
          data-header-status=""
          data-row={statusRow || phone ? '' : undefined}
        >
          {status}
        </div>
      ) : null}
    </PanelHeader>
  )
}

/**
 * Whether the page's status chips need a line of their own: when the title (at its full width),
 * what follows it, the chips and the buttons don't all fit on one line. Measured from the items'
 * natural widths, so the answer doesn't depend on where the chips are now; again whenever the
 * header resizes or the chips change.
 */
function useStatusRow(ref: RefObject<HTMLDivElement | null>, enabled: boolean): boolean {
  const [row, setRow] = useState(false)
  useLayoutEffect(() => {
    const status = ref.current
    const header = status?.closest<HTMLElement>('[data-panel-header]')
    if (!enabled || !status || !header) return undefined
    const measure = () => {
      keepTitleWhole(header)
      setRow(lineOverflows(header))
    }
    measure()
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    resize?.observe(header)
    // A new title changes the width the crumbs must keep.
    const current = header.querySelector('nav[aria-label="Breadcrumb"] li:last-child')
    if (current) resize?.observe(current)
    const changes = new MutationObserver(measure)
    changes.observe(status, { childList: true, subtree: true, characterData: true })
    return () => {
      resize?.disconnect()
      changes.disconnect()
    }
  }, [ref, enabled])
  return row
}

/**
 * The page's title (the last crumb) never gives up width: the crumbs' floor is its own width, so
 * the crumbs before it and what follows it are what shorten.
 */
function keepTitleWhole(header: HTMLElement) {
  const crumbs = header.querySelector<HTMLElement>('nav[aria-label="Breadcrumb"]')
  const last = crumbs?.querySelector<HTMLElement>('li:last-child')
  if (!crumbs || !last) return
  crumbs.style.setProperty(
    '--circi-title-floor',
    `${Math.ceil(last.getBoundingClientRect().width)}px`,
  )
}

/** Whether the header's items, each at its natural width, are wider than one line of it. */
function lineOverflows(header: HTMLElement): boolean {
  const style = getComputedStyle(header)
  const room =
    header.clientWidth -
    Number.parseFloat(style.paddingLeft) -
    Number.parseFloat(style.paddingRight)
  const gap = Number.parseFloat(style.columnGap) || 0
  const items = [...header.children].filter(
    (el): el is HTMLElement => el instanceof HTMLElement && getComputedStyle(el).display !== 'none',
  )
  let total = gap * Math.max(0, items.length - 1)
  for (const el of items) {
    const before = el.style.cssText
    el.style.flex = 'none'
    el.style.width = 'max-content'
    total += el.getBoundingClientRect().width
    el.style.cssText = before
  }
  return total > room + 0.5
}

/**
 * A phone's row under the page header: the page's find field, and on a project's pages the icons
 * of its pages (Builds, Triage, Baselines) on its right. Nothing when the page has neither.
 */
function PhoneFindRow({ find }: { find: ReactNode }) {
  const tabs = usePhoneProjectTabs()
  if (!find && !tabs) return null
  return (
    <div className={styles.find}>
      {find ? <div className={styles.findField}>{find}</div> : null}
      {tabs ? <PhoneProjectTabs /> : null}
    </div>
  )
}

/** For a page that has no breadcrumb: its `<h1>`, there for assistive technology only. */
export function PageTitle({ children }: PageTitle.Props) {
  return <h1 style={visuallyHidden}>{children}</h1>
}

export namespace PageHeading {
  export type Crumb = CrumbType
  export interface Props {
    /** The page's ancestors, outermost first. */
    crumbs?: ReadonlyArray<Crumb>
    /** The current page's name: the `<h1>`. */
    title: string
    /** Buttons for the page's main actions, on the right. */
    actions?: ReactNode
    /**
     * The page's find field. In the header from 820px up; on a phone it is a full-width row under
     * the header, fixed with it above the scrolling content, so the header stays one compact row.
     */
    find?: ReactNode
    /** Something that belongs beside the title (a branch name), right after the breadcrumb. */
    after?: ReactNode
    /**
     * On a phone, `after` gets a row of its own under the title and the buttons (a build's long
     * branch), instead of sitting beside the title (a count). False.
     */
    afterOwnRow?: boolean
    /**
     * Chips about the page's state (a build's review status, its target, who was asked), to the
     * left of the buttons. They wrap on their own: short of room they move to a line under the
     * buttons (and wrap among themselves there), so the buttons keep the title's line.
     */
    status?: ReactNode
    /** The page shows its own visible `<h1>` in the body (Integrations): the crumb is then plain text. */
    headingInPage?: boolean
  }
}

export namespace PageTitle {
  export interface Props {
    children: ReactNode
  }
}
