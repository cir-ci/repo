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
export function AdminFrame({ title, error, ...rest }: AdminFrame.Props) {
  return (
    <PageFrame
      crumbs={[{ label: 'Instance' }]}
      title={title}
      error={error}
      forbidden={
        isForbidden(error) ? (
          <EmptyState tone="rejected" icon={<WarningIcon size={32} />} title="Instance admins only">
            Only instance admins can see this page. Ask one to make you an instance admin.
          </EmptyState>
        ) : null
      }
      {...rest}
    />
  )
}

/** The line under the page's title, with the page's main action on the right. */
export function Intro({ action, children }: Intro.Props) {
  if (!children) return <div className={styles.actions}>{action}</div>
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
    children?: ReactNode
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
