import { Delayed, EmptyState, ListSkeleton, Text, WarningIcon } from '@circi/ui'
import type { ReactNode } from 'react'

import { ErrorState } from '#lib/ErrorState.tsx'
import { PageHeading } from '#lib/PageHeading.tsx'

import { isForbidden } from './admin-api.ts'

import styles from './Admin.module.css'

/**
 * The frame every Instance page shares: the header (Instance, then the page's title as the `<h1>`)
 * and one column, with the loading and error states, and the state for someone who is not an
 * instance admin (the server answers 403 to every `/api/instance` read).
 */
export function AdminFrame({ title, loading, error, onRetry, children }: AdminFrame.Props) {
  return (
    <>
      <PageHeading crumbs={[{ label: 'Instance' }]} title={title} />
      <div className={styles.content}>
        {isForbidden(error) ? (
          <EmptyState tone="rejected" icon={<WarningIcon size={32} />} title="Instance admins only">
            Only instance admins can see this page. Ask one to make you an instance admin.
          </EmptyState>
        ) : error ? (
          <ErrorState error={error} {...(onRetry ? { onRetry } : {})} />
        ) : loading ? (
          <Delayed>
            <ListSkeleton />
          </Delayed>
        ) : (
          children
        )}
      </div>
    </>
  )
}

/** The line under the page's title, with the page's main action on the right. */
export function Intro({ action, children }: Intro.Props) {
  return (
    <div className={styles.intro}>
      <Text tone="secondary">{children}</Text>
      {action}
    </div>
  )
}

export namespace Intro {
  export interface Props {
    action?: ReactNode
    children: ReactNode
  }
}

export namespace AdminFrame {
  export interface Props {
    /** The page's name: the `<h1>`, after "Instance". */
    title: string
    loading?: boolean
    error?: Error | null | undefined
    onRetry?: () => void
    children: ReactNode
  }
}
