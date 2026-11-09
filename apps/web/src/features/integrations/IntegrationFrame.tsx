import type { ReactNode } from 'react'

import { PageFrame } from '#lib/PageFrame.tsx'
import { workspaceCrumb, type PageHeading } from '#lib/PageHeading.tsx'

import styles from './Integrations.module.css'

/** The header, the board's 820px column and the loading and error states every integrations page shares. */
export function IntegrationFrame({ workspace, below, title, ...rest }: IntegrationFrame.Props) {
  return (
    <PageFrame
      crumbs={integrationCrumbs(workspace, below)}
      title={title}
      contentClassName={styles.content}
      {...rest}
    />
  )
}

/** `workspace › Settings` and, on an integration's own page, `› Integrations`. */
function integrationCrumbs(workspace: string, below: boolean | undefined): PageHeading.Crumb[] {
  const settings = { to: '/workspaces/$workspace/settings', params: { workspace } } as const
  return [
    workspaceCrumb({ slug: workspace, name: workspace }),
    { label: 'Settings', link: settings },
    ...(below
      ? [
          {
            label: 'Integrations',
            link: { to: '/workspaces/$workspace/settings/integrations', params: { workspace } },
          } as const,
        ]
      : []),
  ]
}

export namespace IntegrationFrame {
  export interface Props {
    workspace: string
    /** Below the Integrations list (an integration's page) rather than on it. */
    below?: boolean
    /** The page's `<h1>`. */
    title: string
    loading?: boolean
    error?: Error | null
    onRetry?: () => void
    notFound?: string
    /** Shown above the page when the viewer can look but not change. */
    readOnlyNote?: string | false
    children: ReactNode
  }
}
