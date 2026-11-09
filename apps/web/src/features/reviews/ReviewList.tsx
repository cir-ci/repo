import type { Review } from '@circi/api'
import { Avatar, Badge, ListRow, ReviewIcon, StatusIcon } from '@circi/ui'
import type { MouseEventHandler } from 'react'

import { useTeamMark } from '#features/integrations/TeamMark.tsx'
import { RelativeTime } from '#lib/RelativeTime.tsx'

import {
  overdueLabel,
  requestName,
  requestRef,
  requestStatus,
  REVIEW_TABS,
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
  tab,
  total,
  groups,
  selectedId,
  listRef,
  rowProps,
  linkTo,
  onTab,
}: ReviewList.Props) {
  const teamMark = useTeamMark(workspace)
  const person = (r: Review.Request) => (tab === 'created' ? r.reviewer : r.requestedBy)

  return (
    <aside className={styles.sub} aria-label="Reviews">
      <div className={styles.subTop}>
        <span>Reviews</span>
        <span role="status" className={styles.count}>
          {total}
        </span>
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
          </button>
        ))}
      </div>
      <div className={styles.scroll} id="reviews-list" ref={listRef}>
        {groups.length === 0 ? (
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
                            {who ? <Avatar name={who.name} size={20} /> : null}
                            <RelativeTime iso={r.createdAt} />
                          </span>
                        }
                      >
                        <span className={styles.item}>
                          <span className={styles.itemTitle} title={requestName(r)}>
                            Build #{r.build.number}
                          </span>
                          <span className={styles.itemSub}>
                            {teamMark(r.team.slug, r.team.name)}
                            <span>{r.team.name}</span>
                            <span aria-hidden="true">·</span>
                            <span className={styles.branch}>{requestRef(r.build)}</span>
                          </span>
                          {overdue || r.snoozedUntil ? (
                            <span className={styles.chips}>
                              {overdue ? (
                                <Badge tone="state" state="rejected" shape="tag">
                                  {overdue}
                                </Badge>
                              ) : null}
                              {r.snoozedUntil ? (
                                <Badge shape="tag">
                                  Until <RelativeTime iso={r.snoozedUntil} />
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
  snoozed: { title: 'Nothing snoozed', text: 'Requests you put off wait here until they wake.' },
}

export namespace ReviewList {
  export interface Props {
    workspace: string
    tab: Review.Tab
    /** "3 reviews" */
    total: string
    groups: readonly RequestGroup[]
    selectedId: string | undefined
    listRef: (el: HTMLElement | null) => void
    rowProps: (id: string) => { 'data-row-id': string }
    /** A link to this page with other search params (the tab, or the selected review). */
    linkTo: (review: string) => { href: string; onClick: MouseEventHandler<HTMLElement> }
    onTab: (tab: Review.Tab) => void
  }
}
