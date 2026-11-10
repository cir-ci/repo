import { EmptyState, Text, WarningIcon } from '@circi/ui'
import type { ReactNode } from 'react'

import { PageFrame } from '#lib/PageFrame.tsx'

import { isForbidden } from './api/admin.ts'

import styles from './AdminFrame.module.css'

/**
 * The frame every Instance page shares: the header (Instance, then the page's title as the `<h1>`)
 * and one column, with the loading and error states, and the state for someone who is not an
 * instance admin (the server answers 403 to every `/api/instance` read).
 */
export function AdminFrame({ title, action, note, error, children, ...rest }: AdminFrame.Props) {
  // The title is the page's own `<h1>` (15px, beside the main button); while the page can't show
  // its body (loading, an error, not an admin) the breadcrumb is the `<h1>` instead.
  const bodyShown = !rest.loading && !error
  return (
    <PageFrame
      crumbs={[{ label: 'Instance' }]}
      title={title}
      headingInPage={bodyShown}
      error={error}
      forbidden={
        isForbidden(error) ? (
          <EmptyState tone="rejected" icon={<WarningIcon size={32} />} title="Instance admins only">
            Only instance admins can see this page. Ask one to make you an instance admin.
          </EmptyState>
        ) : null
      }
      {...rest}
    >
      <div className={styles.intro}>
        <div className={styles.heading}>
          <h1 className={styles.title}>{title}</h1>
          {note ? <Text tone="secondary">{note}</Text> : null}
        </div>
        {action}
      </div>
      {children}
    </PageFrame>
  )
}

export namespace AdminFrame {
  export interface Props {
    /** The page's name: the `<h1>`, after "Instance". */
    title: string
    /** The page's main button, beside the title. */
    action?: ReactNode
    /** A status line under the title (not an explanation of the page). */
    note?: ReactNode
    loading?: boolean
    error?: Error | null | undefined
    onRetry?: () => void
    children: ReactNode
  }
}
