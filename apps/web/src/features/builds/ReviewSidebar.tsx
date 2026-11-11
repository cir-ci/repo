import type { Build } from '@circi/api'
import { Badge, Button, Kbd, Stack, StatusIcon, TabList, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import type { Ref } from 'react'

import { activityQuery, commentsQuery } from '#features/builds/api/discussion.ts'
import { authClient } from '#lib/auth-client.ts'
import { RelativeTime, useNow } from '#lib/RelativeTime.tsx'

import { ActivityTab } from './ActivityTab.tsx'
import { BuildStateLabel } from './BuildStateLabel.tsx'
import { CommentsTab } from './CommentsTab.tsx'
import { LinkedIssues } from './LinkedIssues.tsx'
import { openReviewerPeople, reviewTargetStatus } from './review-model.ts'
import { commentCount } from './timeline.ts'

import styles from './Discussion.module.css'

export const SIDEBAR_TABS = ['details', 'activity', 'comments'] as const
export type SidebarTab = (typeof SIDEBAR_TABS)[number]

const TAB_LABEL: Record<SidebarTab, string> = {
  details: 'Details',
  activity: 'Activity',
  comments: 'Comments',
}

/** Details / Activity / Comments beside the viewer: tabs over one panel (arrow keys, Home / End). */
export function ReviewSidebar(props: ReviewSidebar.Props) {
  const { data, tab, onTab } = props
  const { project, build } = data
  const comments = useQuery(commentsQuery(project.workspaceSlug, project.slug, build.number))
  const count = commentCount(comments.data?.comments ?? [])
  const tabs = SIDEBAR_TABS.map((t) => ({
    value: t,
    label:
      t === 'comments' && count > 0 ? (
        <>
          {TAB_LABEL[t]}
          <Badge>{count}</Badge>
        </>
      ) : (
        TAB_LABEL[t]
      ),
  }))

  return (
    <aside aria-label="Build discussion" className={styles.sidebar}>
      <TabList
        label="Build sidebar"
        size="sm"
        tabs={tabs}
        value={tab}
        onChange={onTab}
        panelClassName={styles.panel}
      >
        {tab === 'details' ? (
          <DetailsTab
            data={data}
            snapshotName={props.snapshotName}
            onRequestReview={props.onRequestReview}
          />
        ) : tab === 'activity' ? (
          <ActivityTab
            workspace={project.workspaceSlug}
            project={project.slug}
            number={build.number}
            onOpenComment={props.onOpenComment}
          />
        ) : (
          <CommentsTab
            workspace={project.workspaceSlug}
            project={project.slug}
            number={build.number}
            snapshotName={props.snapshotName}
            focusedId={props.focusedId}
            composerRef={props.composerRef}
            onShowSnapshot={props.onShowSnapshot}
          />
        )}
      </TabList>
    </aside>
  )
}

export namespace ReviewSidebar {
  export interface Props {
    data: Build.Detail
    tab: SidebarTab
    onTab: (tab: SidebarTab) => void
    snapshotName: string | null
    focusedId: string | null
    composerRef: Ref<HTMLTextAreaElement>
    onOpenComment: (commentId: string) => void
    onShowSnapshot: (snapshotName: string, commentId: string) => void
    onRequestReview: () => void
  }
}

/** The build's facts and its decisions so far. */
function DetailsTab({ data, snapshotName, onRequestReview }: DetailsTab.Props) {
  const { build, baseline, reviews } = data
  const now = useNow()
  const { data: session } = authClient.useSession()
  const { data: activity } = useQuery(
    activityQuery(data.project.workspaceSlug, data.project.slug, build.number),
  )
  const reviewers = openReviewerPeople(activity?.events ?? [])
  const target = reviewTargetStatus(data.reviewTarget, now)
  const watching = data.watchers.some((w) => w.id === session?.user.id)
  // The decision on each snapshot, when it has one (the build's own decisions are listed above).
  const decided = data.diffs.flatMap((d) =>
    d.review ? [{ id: d.id, name: d.name, review: d.review }] : [],
  )
  return (
    <>
      <dl className={styles.facts}>
        <Text as="dt" variant="small" tone="secondary">
          Status
        </Text>
        <dd className={styles.fact}>
          <BuildStateLabel build={build} hasBaseline={baseline !== null} />
        </dd>
        <Text as="dt" variant="small" tone="secondary">
          Reviewers
        </Text>
        <Text as="dd">
          {reviewers.length > 0 ? reviewers.map((p) => p.name).join(', ') : 'None'}
        </Text>
        <Text as="dt" variant="small" tone="secondary">
          Review target
        </Text>
        <Text as="dd" tone={target?.overdue ? 'failed' : 'primary'}>
          {target
            ? target.long
            : data.reviewTarget.hours === null
              ? 'None'
              : `${data.reviewTarget.hours}h`}
        </Text>
        {data.pullRequest ? (
          <>
            <Text as="dt" variant="small" tone="secondary">
              Pull request
            </Text>
            <Text as="dd" variant="mono">
              {data.pullRequest.repo ? `${data.pullRequest.repo}#` : '#'}
              {data.pullRequest.number}
            </Text>
          </>
        ) : null}
        <Text as="dt" variant="small" tone="secondary">
          Watchers
        </Text>
        <Text as="dd" title={data.watchers.map((w) => w.name).join(', ')}>
          {data.watchers.length > 0
            ? `${data.watchers.length}${watching ? " · you're watching" : ''}`
            : 'Nobody'}
        </Text>
        <Text as="dt" variant="small" tone="secondary">
          Branch
        </Text>
        <Text as="dd" variant="mono">
          {build.branch ?? 'unknown'}
        </Text>
        <Text as="dt" variant="small" tone="secondary">
          Commit
        </Text>
        <Text as="dd" variant="mono" title={build.commitSha}>
          {build.commitSha.slice(0, 7)}
        </Text>
        <Text as="dt" variant="small" tone="secondary">
          Compared with
        </Text>
        <Text as="dd">
          {baseline
            ? `build #${baseline.number} on ${baseline.branch ?? 'an unknown branch'}`
            : 'nothing yet'}
        </Text>
        <Text as="dt" variant="small" tone="secondary">
          Uploaded
        </Text>
        <Text as="dd">
          <RelativeTime iso={build.createdAt} />
        </Text>
      </dl>
      <Stack direction="row" gap={2} align="center">
        <Button size="sm" onClick={onRequestReview}>
          Request a review
        </Button>
        <Kbd>⇧</Kbd>
        <Kbd>R</Kbd>
      </Stack>
      <LinkedIssues issues={data.issues} />
      <div>
        <Text variant="micro" tone="tertiary">
          Decisions
        </Text>
        {reviews.length === 0 ? (
          <Text as="p" tone="secondary">
            Nobody has decided yet.
          </Text>
        ) : (
          <ul className={styles.list}>
            {reviews.map((r) => (
              <li key={`${r.createdAt}-${r.state}-${r.userName}`} className={styles.event}>
                <StatusIcon status={r.state} size={14} decorative />
                <div className={styles.eventBody}>
                  <Text>
                    {r.state === 'approved' ? 'Approved' : 'Rejected'}
                    {r.source === 'auto' || r.source === 'rerun'
                      ? ' automatically'
                      : ` by ${r.userName ?? 'someone who has left'}`}{' '}
                    <Text variant="small" tone="tertiary">
                      <RelativeTime iso={r.createdAt} />
                    </Text>
                  </Text>
                  {r.reason ? (
                    <Text variant="small" tone="secondary" as="p" className={styles.quote}>
                      {r.reason}
                    </Text>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {decided.length > 0 ? (
        <div>
          <Text variant="micro" tone="tertiary">
            By screenshot
          </Text>
          <ul className={styles.list}>
            {decided.map((d) => (
              <li
                key={d.id}
                className={styles.event}
                aria-current={d.name === snapshotName ? 'true' : undefined}
              >
                <StatusIcon status={d.review.decision} size={14} decorative />
                <div className={styles.eventBody}>
                  <Text className={styles.snapshotName}>{d.name}</Text>
                  <Text>
                    {d.review.decision === 'approved' ? 'Approved' : 'Rejected'}
                    {d.review.reviewer
                      ? ` by ${d.review.reviewer.name}`
                      : d.review.decision === 'approved'
                        ? ' automatically'
                        : ''}{' '}
                    <Text variant="small" tone="tertiary">
                      <RelativeTime iso={d.review.at} />
                    </Text>
                  </Text>
                  {d.review.reason ? (
                    <Text variant="small" tone="secondary" as="p" className={styles.quote}>
                      {d.review.reason}
                    </Text>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  )
}

namespace DetailsTab {
  export interface Props {
    data: Build.Detail
    /** The snapshot on screen: its own decision is highlighted. */
    snapshotName: string | null
    onRequestReview: () => void
  }
}
