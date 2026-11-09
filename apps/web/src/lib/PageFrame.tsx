import { Banner } from '@circi/ui'
import type { ReactNode } from 'react'

import { ErrorState } from '#lib/ErrorState.tsx'
import { PageHeading } from '#lib/PageHeading.tsx'
import { QuerySkeleton } from '#lib/QueryBoundary.tsx'

/**
 * The frame of a settings-style page: its header (`PageHeading`: crumbs, then `title` as the
 * `<h1>`), one column (`contentClassName` is the feature's own CSS module class), and the column's
 * states: `forbidden`, the error, the delayed skeleton, or the read-only note above `children`.
 * The feature frames (`Frame`, `IntegrationFrame`, `AdminFrame`, `TeamSettingsFrame`) only compute
 * the crumbs and pass the feature's column class.
 */
export function PageFrame({
  crumbs,
  title,
  contentClassName,
  width,
  loading,
  error,
  onRetry,
  notFound,
  forbidden,
  readOnlyNote,
  children,
}: PageFrame.Props) {
  return (
    <>
      <PageHeading crumbs={crumbs} title={title} />
      <div className={contentClassName} {...(width ? { 'data-width': width } : {})}>
        {forbidden ? (
          forbidden
        ) : error ? (
          <ErrorState
            error={error}
            {...(onRetry ? { onRetry } : {})}
            {...(notFound ? { notFound } : {})}
          />
        ) : loading ? (
          <QuerySkeleton />
        ) : (
          <>
            {readOnlyNote ? <Banner>{readOnlyNote}</Banner> : null}
            {children}
          </>
        )}
      </div>
    </>
  )
}

export namespace PageFrame {
  export interface Props {
    /** The page's ancestors, outermost first. */
    crumbs: ReadonlyArray<PageHeading.Crumb>
    /** The page's `<h1>`. */
    title: string
    contentClassName?: string | undefined
    /** The column's `data-width`, for the feature's CSS. */
    width?: string | undefined
    loading?: boolean | undefined
    error?: Error | null | undefined
    onRetry?: (() => void) | undefined
    notFound?: string | undefined
    /** Replaces the column's content (someone who may not see the page). */
    forbidden?: ReactNode
    /** Shown above the page when the viewer can look but not change. */
    readOnlyNote?: string | false | undefined
    children?: ReactNode
  }
}
