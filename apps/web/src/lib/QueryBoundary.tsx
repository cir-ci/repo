import { Delayed, ListSkeleton } from '@circi/ui'
import type { ReactNode } from 'react'

import { useLoadingAnnouncement } from '#features/builds/list/loading.ts'
import { ErrorState } from '#lib/ErrorState.tsx'

/**
 * The loading, error and not-found states of a query, in one place: an error shows `ErrorState`
 * (with a retry, and `notFound` for a 404), a query without data yet shows the delayed skeleton and
 * tells screen readers (`announce`), and once there is data `children` renders it. `forbidden`,
 * when given, replaces the error state for the errors `isForbidden` accepts.
 *
 *   <QueryBoundary query={q} announce="Loading your inbox" notFound="This team doesn't exist">
 *     {(data) => <InboxList data={data} />}
 *   </QueryBoundary>
 */
export function QueryBoundary<T>({
  query,
  announce,
  notFound,
  forbidden,
  isForbidden,
  skeleton,
  rows,
  children,
}: QueryBoundary.Props<T>) {
  const { data, error, refetch } = query
  useLoadingAnnouncement(!data && !error, announce ?? 'Loading')
  if (error) {
    if (forbidden && isForbidden?.(error)) return <>{forbidden}</>
    return (
      <ErrorState
        error={error}
        onRetry={() => void refetch()}
        {...(notFound ? { notFound } : {})}
      />
    )
  }
  if (!data) return <>{skeleton ?? <QuerySkeleton rows={rows} />}</>
  return <>{children(data)}</>
}

/** The skeleton every loading state shows, after the short delay that avoids a flash. */
export function QuerySkeleton({ rows }: QuerySkeleton.Props) {
  return (
    <Delayed>
      <ListSkeleton {...(rows ? { rows } : {})} />
    </Delayed>
  )
}

export namespace QuerySkeleton {
  export interface Props {
    rows?: number | undefined
  }
}

export namespace QueryBoundary {
  /** The part of a react-query result the boundary reads. */
  export interface Query<T> {
    data: T | undefined
    error: Error | null
    refetch: () => unknown
  }
  export interface Props<T> {
    query: Query<T>
    /** What screen readers hear if loading takes a while (nothing is announced without it). */
    announce?: string
    /** The title shown for a 404, instead of the generic error. */
    notFound?: string
    /** Shown instead of the error for errors `isForbidden` accepts. */
    forbidden?: ReactNode
    isForbidden?: (error: Error) => boolean
    /** Replaces the default skeleton. */
    skeleton?: ReactNode
    /** Rows of the default skeleton. */
    rows?: number
    children: (data: T) => ReactNode
  }
}
