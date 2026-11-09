import { Banner, Delayed, ListSkeleton } from '@circi/ui'
import type { ReactNode } from 'react'

import { ErrorState } from '#lib/ErrorState.tsx'
import { PageHeading } from '#lib/PageHeading.tsx'

import styles from './Settings.module.css'

/** The header and one column every settings page here shares, with its loading and error states. */
export function Frame(props: Frame.Props) {
  return (
    <>
      <PageHeading
        crumbs={props.crumbs.slice(0, -1).map((label) => ({ label }))}
        title={props.crumbs.at(-1) ?? ''}
      />
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

export namespace Frame {
  export interface Props {
    /** The path to the page, outermost first; the last is the page's `<h1>`. */
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
