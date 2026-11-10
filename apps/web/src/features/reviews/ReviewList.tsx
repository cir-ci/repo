import type { Review } from '@circi/api'
import { Avatar, Badge, ListRow, ReviewIcon, StatusIcon } from '@circi/ui'
import type { MouseEventHandler } from 'react'

import { useTeamMark } from '#features/integrations/TeamMark.tsx'
import { FindField, NoMatches } from '#lib/FindField.tsx'
import { RelativeTime } from '#lib/RelativeTime.tsx'

import {
  decisionLabel,
  overdueLabel,
  reasonLabel,
  requestName,
  requestTitle,
  requestRef,
  requestStatus,
  REVIEW_TABS,
  snoozedLabel,
  type RequestGroup,
} from './api.ts'

import styles from './Reviews.module.css'

/**
 * The 340px list beside the selected review: the count, the tabs, then the requests under their
 * group headings. A row selects its review (the address carries `?review=`); J / K and Enter
 * are bound by the page.
 */
export function ReviewList({
  workspace,
  userId,
  tab,
  pending,
  snoozed,
  groups,
  selectedId,
  find,
  onFind,
  hasRequests,
  listRef,
  rowProps,
  linkTo,
  onTab,
}: ReviewList.Props) {
  const teamMark = useTeamMark(workspace)
  const person = (r: Review.Request) =>
    tab === 'created' || tab === 'all-open' ? r.reviewer : r.requestedBy

  return (
    <aside className={styles.sub} aria-label="Reviews">
      <div className={styles.subTop}>
        <span>Reviews</span>
        {pending > 0 ? (
          <span
            role="status"
            className={styles.count}
            aria-label={`${pending} ${pending === 1 ? 'review' : 'reviews'} waiting on you`}
          >
            {pending}
          </span>
        ) : null}
      </div>
      <div className={styles.tabs} role="group" aria-label="Which reviews">
        {REVIEW_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            className={styles.tab}
            aria-pressed={t.value === tab}
            onClick={() => onTab(t.value)}
          >
            {t.label}
            {t.value === 'for-you' && pending > 0 ? (
              <span className={styles.tabCount}>{pending}</span>
            ) : null}
            {t.value === 'snoozed' && snoozed > 0 ? (
              <span className={styles.tabCount}>{snoozed}</span>
            ) : null}
          </button>
        ))}
      </div>
      <div className={styles.find}>
        <FindField noun="reviews" value={find} onChange={onFind} />
      </div>
      <div className={styles.scroll} id="reviews-list" ref={listRef}>
        {groups.length === 0 && hasRequests && find.trim() !== '' ? (
          <NoMatches noun="reviews" query={find} />
        ) : groups.length === 0 ? (
          <div className={styles.empty}>
            <ReviewIcon size={28} />
            <p className={styles.emptyTitle}>{EMPTY[tab].title}</p>
            <p className={styles.emptyText}>{EMPTY[tab].text}</p>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.id} aria-labelledby={`reviews-${group.id}`}>
              <h2 className={styles.groupHeader} id={`reviews-${group.id}`}>
                <StatusIcon status={group.status} size={12} decorative />
                {group.label}
                <span className={styles.groupCount}>{group.items.length}</span>
              </h2>
              <ul className={styles.items} aria-label={group.label}>
                {group.items.map((r) => {
                  const overdue = overdueLabel(r.overdueByMs)
                  const why = reasonLabel(r, userId)
                  const decision = decisionLabel(r)
                  const who = person(r)
                  const link = linkTo(r.id)
                  return (
                    <li key={r.id} {...rowProps(r.id)}>
                      <ListRow
                        density="two-line"
                        selected={r.id === selectedId}
                        href={link.href}
                        onClick={link.onClick}
                        leading={
                          <StatusIcon
                            status={requestStatus(r).status}
                            label={requestStatus(r).label}
                            size={14}
                          />
                        }
                        trailing={
                          <span className={styles.itemSide}>
                            {who ? <Avatar type="user" {...who} size={20} /> : null}
                            <RelativeTime iso={r.createdAt} />
                          </span>
                        }
                      >
                        <span className={styles.item}>
                          <span className={styles.itemTitle} title={requestName(r)}>
                            {requestTitle(r)}
                          </span>
                          <span className={styles.itemSub}>
                            {teamMark(r.team.slug, r.team.name)}
                            <span>{r.team.name}</span>
                            <span aria-hidden="true">·</span>
                            <span className={styles.branch}>{requestRef(r.build)}</span>
                          </span>
                          {overdue || r.snoozedUntil || why || decision ? (
                            <span className={styles.chips}>
                              {decision ? (
                                <Badge
                                  tone="state"
                                  state={r.decision === 'approved' ? 'approved' : 'rejected'}
                                  shape="tag"
                                >
                                  {decision}
                                </Badge>
                              ) : null}
                              {why ? <Badge shape="tag">{why}</Badge> : null}
                              {overdue ? (
                                <Badge tone="state" state="failed" shape="tag">
                                  {overdue}
                                </Badge>
                              ) : null}
                              {r.snoozedUntil ? (
                                <Badge shape="tag">
                                  <time
                                    dateTime={r.snoozedUntil}
                                    title={`Until ${new Date(r.snoozedUntil).toLocaleString()}`}
                                  >
                                    {snoozedLabel(r.snoozedUntil, Date.now())}
                                  </time>
                                </Badge>
                              ) : null}
                            </span>
                          ) : null}
                        </span>
                      </ListRow>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </aside>
  )
}

const EMPTY: Record<Review.Tab, { title: string; text: string }> = {
  'for-you': {
    title: 'Nothing waiting on you',
    text: 'When a build needs your review, it shows up in this list and in the sidebar count.',
  },
  created: { title: 'No requests from you', text: 'Reviews you ask others for appear here.' },
  reviewed: {
    title: 'Nothing reviewed yet',
    text: 'Requests you close by approving or rejecting show up here, latest first.',
  },
  'all-open': {
    title: 'No open reviews',
    text: 'Every open review request in this workspace appears here.',
  },
  snoozed: { title: 'Nothing snoozed', text: 'Requests you put off wait here until they wake.' },
}

export namespace ReviewList {
  export interface Props {
    workspace: string
    /** The signed-in person, so a reason chip can say "You". */
    userId: string | undefined
    tab: Review.Tab
    /** Requests waiting on you in this workspace (the "Requested from you" count). */
    pending: number
    /** Requests you put off in this workspace. */
    snoozed: number
    groups: readonly RequestGroup[]
    selectedId: string | undefined
    /** The find text, and how the field changes it. */
    find: string
    onFind: (next: string) => void
    /** Whether the tab has requests before the find text narrows them. */
    hasRequests: boolean
    listRef: (el: HTMLElement | null) => void
    rowProps: (id: string) => { 'data-row-id': string }
    /** A link to this page with other search params (the tab, or the selected review). */
    linkTo: (review: string) => { href: string; onClick: MouseEventHandler<HTMLElement> }
    onTab: (tab: Review.Tab) => void
  }
}
