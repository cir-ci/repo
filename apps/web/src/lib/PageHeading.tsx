import { Breadcrumbs, PanelHeader, visuallyHidden } from '@circi/ui'
import type { ReactNode } from 'react'

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
}: PageHeading.Props) {
  const clientLink = useClientLink()
  const phone = usePhone()
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
        <div className={styles.after} data-header-row={afterOwnRow ? '' : undefined}>
          {after}
        </div>
      ) : null}
    </PanelHeader>
  )
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
    /** The page shows its own visible `<h1>` in the body (Integrations): the crumb is then plain text. */
    headingInPage?: boolean
  }
}

export namespace PageTitle {
  export interface Props {
    children: ReactNode
  }
}
