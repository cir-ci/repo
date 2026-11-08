import { Banner, Breadcrumbs, Delayed, ListSkeleton, PanelHeader } from '@circi/ui'
import type { ReactNode } from 'react'

import { ErrorState } from '../../lib/ErrorState.tsx'

import styles from './Settings.module.css'

/** The header and one column every settings page here shares, with its loading and error states. */
export function Frame(props: Frame.Props) {
  return (
    <>
      <PanelHeader>
        <Breadcrumbs items={props.crumbs.map((label) => ({ label }))} />
      </PanelHeader>
      <div className={styles['content']}>
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

export namespace Frame {
  export interface Props {
    crumbs: string[]
    loading?: boolean
    error?: Error | null
    onRetry?: () => void
    notFound?: string
    /** Shown above the page when the viewer can look but not change. */
    readOnlyNote?: string | false
    children: ReactNode
  }
}
