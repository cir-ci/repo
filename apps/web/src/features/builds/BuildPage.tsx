import { type Build } from '@circi/api'
import { Skeleton } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'

import { ErrorState, RouterLink, useDocumentTitle } from '../../components.tsx'
import { Delayed, useAnnounce } from '../../primitives/feedback.tsx'
import { PageHeader, ParentLinkContent } from '../../primitives/PageHeader.tsx'
import { PageLayout } from '../../primitives/PageLayout.tsx'
import { buildQuery, isActive } from './api.ts'
import { BuildReview } from './BuildReview.tsx'
import { ROUTE } from './route.ts'

export function BuildPage() {
  const params = useParams({ from: ROUTE })
  const number = Number(params.number)
  const { data, error, refetch } = useQuery(buildQuery(params.org, params.project, number))
  useDocumentTitle(`Build #${number}`, params.project)
  useProcessingAnnouncement(data)

  const parentLink = (
    <RouterLink to="/$org/$project" params={{ org: params.org, project: params.project }}>
      <ParentLinkContent>{params.project}</ParentLinkContent>
    </RouterLink>
  )

  if (error) {
    return (
      <PageLayout header={<PageHeader title={`Build #${number}`} parentLink={parentLink} />}>
        <ErrorState
          error={error}
          onRetry={() => void refetch()}
          notFound="This build doesn’t exist"
        />
      </PageLayout>
    )
  }
  if (!data) {
    // The title is known from the URL, so only the rest waits; placeholders keep the layout still.
    return (
      <PageLayout
        header={
          <PageHeader
            title={`Build #${number}`}
            parentLink={parentLink}
            description={
              <Delayed>
                <Skeleton width={320} />
              </Delayed>
            }
          />
        }
        pane={
          <Delayed>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={44} />
            ))}
          </Delayed>
        }
      >
        <Delayed>
          <Skeleton variant="rounded" height={420} />
        </Delayed>
      </PageLayout>
    )
  }
  return <BuildReview data={data} parentLink={parentLink} />
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
