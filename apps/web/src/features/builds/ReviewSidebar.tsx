import type { Build, Comment } from '@circi/api'
import { Badge, Button, Kbd, Stack, StatusIcon, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { type KeyboardEvent, type Ref, useId } from 'react'

import { commentsQuery } from '#features/builds/api/discussion.ts'
import { RelativeTime } from '#lib/RelativeTime.tsx'

import { ActivityTab } from './ActivityTab.tsx'
import { CommentsTab } from './CommentsTab.tsx'
import { LinkedIssues } from './LinkedIssues.tsx'
import { commentCount } from './timeline.ts'

import styles from './Discussion.module.css'

export const SIDEBAR_TABS = ['details', 'activity', 'comments'] as const
export type SidebarTab = (typeof SIDEBAR_TABS)[number]

const TAB_LABEL: Record<SidebarTab, string> = {
  details: 'Details',
  activity: 'Activity',
  comments: 'Comments',
}

/** The tab an arrow key or Home / End moves to from `current`, or undefined for any other key. */
export function tabForKey(current: SidebarTab, key: string): SidebarTab | undefined {
  const i = SIDEBAR_TABS.indexOf(current)
  const last = SIDEBAR_TABS.length - 1
  if (key === 'ArrowRight') return SIDEBAR_TABS[i === last ? 0 : i + 1]
  if (key === 'ArrowLeft') return SIDEBAR_TABS[i === 0 ? last : i - 1]
  if (key === 'Home') return SIDEBAR_TABS[0]
  if (key === 'End') return SIDEBAR_TABS[last]
  return undefined
}

/** Details / Activity / Comments beside the viewer: a tablist with roving focus. */
export function ReviewSidebar(props: ReviewSidebar.Props) {
  const { data, tab, onTab } = props
  const { team, build } = data
  const id = useId()
  const comments = useQuery(commentsQuery(team.workspaceSlug, team.slug, build.number))
  const count = commentCount(comments.data?.comments ?? [])

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const next = tabForKey(tab, e.key)
    if (!next) return
    e.preventDefault()
    onTab(next)
    document.getElementById(`${id}-tab-${next}`)?.focus()
  }

  return (
    <aside aria-label="Build discussion" className={styles.sidebar}>
      {/* The arrow keys are the tablist's own: the wrapper only forwards them. */}
      <div role="tablist" aria-label="Build sidebar" className={styles.tabs} onKeyDown={onKeyDown}>
        {SIDEBAR_TABS.map((t) => (
          <button
            key={t}
            id={`${id}-tab-${t}`}
            type="button"
            role="tab"
            className={styles.tab}
            aria-selected={t === tab}
            aria-controls={`${id}-panel`}
            tabIndex={t === tab ? 0 : -1}
            onClick={() => onTab(t)}
          >
            {TAB_LABEL[t]}
            {t === 'comments' && count > 0 ? <Badge>{count}</Badge> : null}
          </button>
        ))}
      </div>
      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${tab}`}
        className={styles.panel}
      >
        {tab === 'details' ? (
          <DetailsTab data={data} onRequestReview={props.onRequestReview} />
        ) : tab === 'activity' ? (
          <ActivityTab
            workspace={team.workspaceSlug}
            team={team.slug}
            number={build.number}
            onOpenComment={props.onOpenComment}
          />
        ) : (
          <CommentsTab
            workspace={team.workspaceSlug}
            team={team.slug}
            number={build.number}
            snapshotName={props.snapshotName}
            pendingRegion={props.pendingRegion}
            onClearRegion={props.onClearRegion}
            focusedId={props.focusedId}
            composerRef={props.composerRef}
            onShowSnapshot={props.onShowSnapshot}
          />
        )}
      </div>
    </aside>
  )
}

export namespace ReviewSidebar {
  export interface Props {
    data: Build.Detail
    tab: SidebarTab
    onTab: (tab: SidebarTab) => void
    snapshotName: string | null
    pendingRegion: Comment.Region | null
    onClearRegion: () => void
    focusedId: string | null
    composerRef: Ref<HTMLTextAreaElement>
    onOpenComment: (commentId: string) => void
    onShowSnapshot: (snapshotName: string, commentId: string) => void
    onRequestReview: () => void
  }
}

/** The build's facts and its decisions so far. */
function DetailsTab({ data, onRequestReview }: DetailsTab.Props) {
  const { build, baseline, reviews } = data
  return (
    <>
      <dl className={styles.facts}>
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
    </>
  )
}

namespace DetailsTab {
  export interface Props {
    data: Build.Detail
    onRequestReview: () => void
  }
}
