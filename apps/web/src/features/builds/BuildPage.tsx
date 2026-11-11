import type { Build } from '@circi/api'
import { Delayed, ListSkeleton, Skeleton, useAnnounce } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'

import { buildQuery, isActive } from '#features/builds/api/index.ts'
import { useCrumbNames } from '#features/projects/crumb-names.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { ErrorState } from '#lib/ErrorState.tsx'
import { crumbsFor, PageHeading, projectBuildsCrumb } from '#lib/PageHeading.tsx'

import { buildTitle } from './build-title.ts'
import { BuildReview } from './BuildReview.tsx'
import { ROUTE } from './search.ts'

import styles from './BuildPage.module.css'

export function BuildPage() {
  const params = useParams({ from: ROUTE })
  const number = Number(params.number)
  const { data, error, refetch } = useQuery(buildQuery(params.workspace, params.project, number))
  useDocumentTitle(`Build #${number}`, params.project)
  useProcessingAnnouncement(data)
  const names = useCrumbNames(params.workspace, params.project)

  if (data) return <BuildReview data={data} />

  // The breadcrumb is known from the URL, so only the rest waits; placeholders keep the layout still.
  return (
    <div className={styles.page}>
      <PageHeading
        crumbs={crumbsFor(names, [projectBuildsCrumb(params.workspace, params.project)])}
        title={buildTitle(number)}
      />
      {error ? (
        <ErrorState
          error={error}
          onRetry={() => void refetch()}
          notFound="This build doesn't exist"
        />
      ) : (
        <div className={styles.body}>
          <div className={styles.list}>
            <Delayed>
              <ListSkeleton rows={6} />
            </Delayed>
          </div>
          <div className={styles.placeholder}>
            <Delayed>
              <Skeleton height={420} />
            </Delayed>
          </div>
        </div>
      )}
    </div>
  )
}

/** Tells screen reader users once when a build they're watching finishes processing. */
function useProcessingAnnouncement(data: Build.Detail | undefined) {
  const announce = useAnnounce()
  const wasActive = useRef<boolean | undefined>(undefined)
  useEffect(() => {
    if (!data) return
    const active = isActive(data.build.status)
    if (wasActive.current && !active) {
      const c = data.build.counts
      announce(
        `Build #${data.build.number} processed: ${c.changed} changed, ${c.added} added, ${c.removed} removed.`,
      )
    }
    wasActive.current = active
  }, [data, announce])
}
