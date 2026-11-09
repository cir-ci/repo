import type { ReactNode } from 'react'

import { useCrumbNames } from '#features/teams/crumb-names.ts'
import { crumbsFor, workspaceSettingsCrumb } from '#lib/crumbs.ts'
import { PageFrame } from '#lib/PageFrame.tsx'
import type { PageHeading } from '#lib/PageHeading.tsx'

/** The header, the one centred column and the loading and error states every integrations page shares. */
export function IntegrationFrame({ workspace, below, title, ...rest }: IntegrationFrame.Props) {
  const { workspace: named } = useCrumbNames(workspace)
  return <PageFrame crumbs={integrationCrumbs(named, below)} title={title} {...rest} />
}

/** `Workspace › Settings` and, on an integration's own page, `› Integrations`. */
function integrationCrumbs(
  workspace: { slug: string; name: string },
  below: boolean | undefined,
): PageHeading.Crumb[] {
  return crumbsFor({ workspace }, [
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
    loading?: boolean
    error?: Error | null
    onRetry?: () => void
    notFound?: string
    /** Shown above the page when the viewer can look but not change. */
    readOnlyNote?: string | false
    children: ReactNode
  }
}
