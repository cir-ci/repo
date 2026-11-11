import { SettingsPage } from '@circi/ui'
import type { ReactNode } from 'react'

import { ErrorState } from '#lib/ErrorState.tsx'
import { PageHeading } from '#lib/PageHeading.tsx'
import { QuerySkeleton } from '#lib/QueryBoundary.tsx'
import { useScrollToHash } from '#lib/scroll-to-hash.ts'

/**
 * The frame of a settings-style page: its header (`PageHeading`: crumbs, then `title` as the
 * `<h1>`), one `SettingsPage` column (720px, or 1040px with `width="wide"`), and the column's
 * states: `forbidden`, the error, the delayed skeleton, or `children`.
 * An address with a hash (`#retention`) scrolls to the setting with that ID once it renders, and
 * flashes it (`useScrollToHash`).
 * The feature frames (`Frame`, `IntegrationFrame`, `AdminFrame`, `TeamSettingsFrame`) only compute
 * the crumbs.
 */
export function PageFrame({
  crumbs,
  title,
  headingInPage,
  header,
  actions,
  find,
  after,
  width,
  loading,
  error,
  onRetry,
  notFound,
  forbidden,
  children,
}: PageFrame.Props) {
  useScrollToHash()
  return (
    <>
      <PageHeading
        crumbs={crumbs}
        title={title}
        headingInPage={headingInPage}
        {...(actions ? { actions } : {})}
        {...(find ? { find } : {})}
        {...(after ? { after } : {})}
      />
      {header}
      <SettingsPage {...(width ? { width } : {})}>
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
          children
        )}
      </SettingsPage>
    </>
  )
}

export namespace PageFrame {
  export interface Props {
    /** The page's ancestors, outermost first. */
    crumbs: ReadonlyArray<PageHeading.Crumb>
    /** The page's `<h1>`. */
    title: string
    /** The page puts its own visible `<h1>` in the body, so the current crumb is not one. */
    headingInPage?: boolean | undefined
    /** The page's main buttons, in the header bar on the title's line. */
    actions?: ReactNode
    /** The page's find field, in the header bar (a full-width row under it on a phone). */
    find?: ReactNode
    /** Beside the title in the header bar (a status line). */
    after?: ReactNode
    /** Between the page's header bar and its column: a team's header with its tabs. */
    header?: ReactNode
    /** `wide` is 1040px, for editors that need the room. */
    width?: 'default' | 'wide' | undefined
    loading?: boolean | undefined
    error?: Error | null | undefined
    onRetry?: (() => void) | undefined
    notFound?: string | undefined
    /** Replaces the column's content (someone who may not see the page); a `Navigate` sends them elsewhere. */
    forbidden?: ReactNode
    children?: ReactNode
  }
}
