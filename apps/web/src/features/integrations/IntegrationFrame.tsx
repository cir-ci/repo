import type { ReactNode } from 'react'

import { useCrumbNames } from '#features/projects/crumb-names.ts'
import { WorkspaceBackLink } from '#features/workspace-settings/WorkspaceBackLink.tsx'
import { settingsCrumbsFor, workspaceSettingsCrumb } from '#lib/crumbs.ts'
import { PageFrame } from '#lib/PageFrame.tsx'
import type { PageHeading } from '#lib/PageHeading.tsx'

/** The header, the one centred column and the loading and error states every integrations page shares. */
export function IntegrationFrame({
  workspace,
  below,
  title,
  children,
  ...rest
}: IntegrationFrame.Props) {
  const { workspace: named } = useCrumbNames(workspace)
  return (
    <PageFrame crumbs={integrationCrumbs(named, below)} title={title} {...rest}>
      {/* An integration's own page goes back to the list; the list goes back to the hub. */}
      {below ? null : <WorkspaceBackLink workspace={workspace} name={named.name} />}
      {children}
    </PageFrame>
  )
}

/** `Workspace › Settings` and, on an integration's own page, `› Integrations`. */
function integrationCrumbs(
  workspace: { slug: string; name: string },
  below: boolean | undefined,
): PageHeading.Crumb[] {
  return settingsCrumbsFor(workspace, [
    workspaceSettingsCrumb(workspace.slug),
    ...(below
      ? [
          {
            label: 'Integrations',
            link: {
              to: '/workspaces/$workspace/settings/integrations',
              params: { workspace: workspace.slug },
            },
          } as const,
        ]
      : []),
  ])
}

export namespace IntegrationFrame {
  export interface Props {
    workspace: string
    /** Below the Integrations list (an integration's page) rather than on it. */
    below?: boolean
    /** The page's `<h1>`. */
    title: string
    /** The page shows its own visible `<h1>`; the current crumb is then plain text. */
    headingInPage?: boolean
    /** The page's main button, in the header bar. */
    actions?: ReactNode
    loading?: boolean
    error?: Error | null
    onRetry?: () => void
    notFound?: string
    /** Replaces the page's content for someone who may not see it (a `Navigate` sends them elsewhere). */
    forbidden?: ReactNode
    children: ReactNode
  }
}
