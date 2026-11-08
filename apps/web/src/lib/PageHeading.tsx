import { Breadcrumbs, PanelHeader, visuallyHidden } from '@circi/ui'
import type { NavigateOptions } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { useClientLink } from './use-client-link.ts'

const NO_CRUMBS: readonly PageHeading.Crumb[] = []

/**
 * THE page-structure rule, for every page in the app: the current breadcrumb is the page's
 * `<h1>`; a page without a breadcrumb has a visually hidden `<h1>` (`PageTitle`).
 *
 * `PageHeading` is the header bar of a page: its ancestors as links (`crumbs`), then `title`,
 * the current page, as the `<h1>` (plain text, no link). Pass `actions` for the page's buttons.
 *
 *   <PageHeading crumbs={[workspaceCrumb(ws), teamCrumb(ws.slug, team)]} title="Webhooks" />
 *
 * A workspace crumb links to Workspace settings and a team crumb to Team settings
 * (`workspaceCrumb`, `teamCrumb`). A top-level page (Inbox, Teams) has no ancestors:
 * `<PageHeading title="Inbox" />`. Keep this API stable: other pages depend on it.
 */
export function PageHeading({ crumbs = NO_CRUMBS, title, actions, after }: PageHeading.Props) {
  const clientLink = useClientLink()
  return (
    <PanelHeader {...(actions ? { actions } : {})}>
      <Breadcrumbs
        currentIsHeading
        items={[
          ...crumbs.map((crumb) => ({
            label: crumb.label,
            ...(crumb.link ? clientLink(crumb.link) : {}),
          })),
          { label: title },
        ]}
      />
      {after}
    </PanelHeader>
  )
}

/** For a page that has no breadcrumb: its `<h1>`, there for assistive technology only. */
export function PageTitle({ children }: PageTitle.Props) {
  return <h1 style={visuallyHidden}>{children}</h1>
}

/** The workspace's crumb: its name, linking to Workspace settings. */
export function workspaceCrumb(workspace: { slug: string; name: string }): PageHeading.Crumb {
  return {
    label: workspace.name,
    link: { to: '/workspaces/$workspace/settings', params: { workspace: workspace.slug } },
  }
}

/** A team's crumb: its name, linking to Team settings. */
export function teamCrumb(
  workspace: string,
  team: { slug: string; name: string },
): PageHeading.Crumb {
  return {
    label: team.name,
    link: { to: '/$workspace/$team/settings', params: { workspace, team: team.slug } },
  }
}

export namespace PageHeading {
  export interface Crumb {
    label: string
    /** Where the crumb goes; without one it is plain text. */
    link?: NavigateOptions
  }
  export interface Props {
    /** The page's ancestors, outermost first. */
    crumbs?: ReadonlyArray<Crumb>
    /** The current page's name: the `<h1>`. */
    title: string
    /** Buttons for the page's main actions, on the right. */
    actions?: ReactNode
    /** Something that belongs beside the title (a branch name), right after the breadcrumb. */
    after?: ReactNode
  }
}

export namespace PageTitle {
  export interface Props {
    children: ReactNode
  }
}
