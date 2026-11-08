import { Banner, Delayed, ListSkeleton } from '@circi/ui'
import type { ReactNode } from 'react'

import { ErrorState } from '#lib/ErrorState.tsx'
import { PageHeading, workspaceCrumb } from '#lib/PageHeading.tsx'

import styles from './Integrations.module.css'

/** The header, the board's 820px column and the loading and error states every integrations page shares. */
export function IntegrationFrame(props: IntegrationFrame.Props) {
  return (
    <>
      <PageHeading crumbs={integrationCrumbs(props.workspace, props.below)} title={props.title} />
      <div className={styles.content}>
        {props.error ? (
          <ErrorState
            error={props.error}
            {...(props.onRetry ? { onRetry: props.onRetry } : {})}
            {...(props.notFound ? { notFound: props.notFound } : {})}
          />
        ) : props.loading ? (
          <Delayed>
            <ListSkeleton />
          </Delayed>
        ) : (
          <>
            {props.readOnlyNote ? <Banner>{props.readOnlyNote}</Banner> : null}
            {props.children}
          </>
        )}
      </div>
    </>
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
