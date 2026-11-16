import type { Build } from '@circi/api'
import { Badge, StatusIcon, TabList, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import type { Ref } from 'react'

import { activityQuery, commentsQuery } from '#features/builds/api/discussion.ts'
import { authClient } from '#lib/auth-client.ts'
import { RelativeTime, useNow } from '#lib/RelativeTime.tsx'
import { usePhone } from '#lib/use-phone.ts'

import { ActivityTab } from './ActivityTab.tsx'
import { BuildSection, PeopleSection, PhoneFacts } from './BuildDetails.tsx'
import { CommentsTab } from './CommentsTab.tsx'
import { LinkedIssues } from './LinkedIssues.tsx'
import { decisionText, groupDecisions, needsDecision, openReviewRequests } from './review-model.ts'
import { ScreenshotHistory } from './ScreenshotHistory.tsx'
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
          <DetailsTab data={data} snapshotName={props.snapshotName} />
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
  }
}

/**
 * What the header leaves out: the build's facts (pull request, commit, branch, upload time and the
 * baseline with how it was chosen), the people asked to review and who asked, the screenshot on
 * screen through recent builds of the default branch, the linked issues, and the decisions so far,
 * the build's and each screenshot's. A phone, with no header chips, lists the state, review target
 * and watchers first.
 */
function DetailsTab({ data, snapshotName }: DetailsTab.Props) {
  const { build, reviews } = data
  const phone = usePhone()
  const now = useNow()
  const { data: session } = authClient.useSession()
  const { data: activity } = useQuery(
    activityQuery(data.project.workspaceSlug, data.project.slug, build.number),
  )
  const requests = openReviewRequests(activity?.events ?? [])
  const watching = data.watchers.some((w) => w.id === session?.user.id)
  // The decision on each snapshot, when it has one (the build's own decisions are listed above).
  const reviewGroups = groupDecisions(
    reviews.map((r) => ({
      decision: r.state,
      by: r.userName,
      automatic: r.source === 'auto' || r.source === 'rerun',
      reason: r.reason,
      at: r.createdAt,
    })),
  )
  // Several screenshots with one decision by one person read as one line ("Approved 6 of 6 by …").
  const shotGroups = groupDecisions(
    data.diffs.flatMap((d) =>
      d.review
        ? [
            {
              decision: d.review.decision,
              by: d.review.reviewer?.name ?? null,
              automatic: d.review.reviewer === null && d.review.decision === 'approved',
              reason: d.review.reason,
              at: d.review.at,
              name: d.name,
            },
          ]
        : [],
    ),
  )
  const needing = data.diffs.filter(needsDecision).length
  return (
    <>
      {phone ? (
        // A phone's header has no status chips: what they say is here instead.
        <PhoneFacts data={data} watching={watching} now={now} />
      ) : null}
      <BuildSection data={data} />
      <PeopleSection requests={requests} />
      {snapshotName ? (
        <ScreenshotHistory
          workspace={data.project.workspaceSlug}
          project={data.project.slug}
          name={snapshotName}
          defaultBranch={data.project.defaultBranch}
        />
      ) : null}
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
            {reviewGroups.map((g) => (
              <li key={g.at + g.decision + g.by} className={styles.event}>
                <StatusIcon status={g.decision} size={14} decorative />
                <div className={styles.eventBody}>
                  <Text>
                    {decisionText(g)}
                    {g.count > 1 ? `, ${g.count} times` : ''}{' '}
                    <Text variant="small" tone="tertiary">
                      <RelativeTime iso={g.at} />
                    </Text>
                  </Text>
                  {g.reason ? (
                    <Text variant="small" tone="secondary" as="p" className={styles.quote}>
                      {g.reason}
                    </Text>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {shotGroups.length > 0 ? (
        <div>
          <Text variant="micro" tone="tertiary">
            By screenshot
          </Text>
          <ul className={styles.list}>
            {shotGroups.map((g) => (
              <li
                key={g.at + g.decision + g.by + g.names[0]}
                className={styles.event}
                aria-current={snapshotName && g.names.includes(snapshotName) ? 'true' : undefined}
              >
                <StatusIcon status={g.decision} size={14} decorative />
                <div className={styles.eventBody}>
                  {g.count > 1 ? (
                    // The same decision on several screenshots (and no reason to read) is one line.
                    <Text>
                      {g.decision === 'approved' ? 'Approved' : 'Rejected'} {g.count} of {needing}
                      {g.automatic || !g.by ? ' automatically' : ` by ${g.by}`}{' '}
                      <Text variant="small" tone="tertiary">
                        <RelativeTime iso={g.at} />
                      </Text>
                    </Text>
                  ) : (
                    <>
                      <Text className={styles.snapshotName}>{g.names[0]}</Text>
                      <Text>
                        {decisionText(g)}{' '}
                        <Text variant="small" tone="tertiary">
                          <RelativeTime iso={g.at} />
                        </Text>
                      </Text>
                    </>
                  )}
                  {g.reason ? (
                    <Text variant="small" tone="secondary" as="p" className={styles.quote}>
                      {g.reason}
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
  }
}
