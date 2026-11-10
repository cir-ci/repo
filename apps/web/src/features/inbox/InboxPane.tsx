import type { Inbox } from '@circi/api'
import { Avatar, Badge, Button, Kbd, Pane, StatusIcon, TextField, useAnnounce } from '@circi/ui'
import { useState, type ReactNode } from 'react'

import { buildStatus, changeSummary, overdueLabel } from '#features/reviews/api.ts'
import { RelativeTime } from '#lib/RelativeTime.tsx'
import type { SnoozeChoice } from '#lib/snooze.ts'
import { SnoozeMenu } from '#lib/SnoozeMenu.tsx'
import { useClientLink } from '#lib/use-client-link.ts'

import {
  awaitsYourReview,
  notificationNote,
  notificationTarget,
  notificationText,
  openLabel,
  replyTarget,
  systemText,
  useReplyToMention,
} from './api.ts'

import styles from './InboxPage.module.css'

/**
 * The notification beside the list (420px): what happened, who said what, the build's details,
 * a reply box where the notice allows one, and the actions: read state, delete, snooze (or
 * unsnooze), Open, and Approve all while the build still waits for your review.
 */
export function InboxPane({
  item,
  snoozedTab,
  snoozeOpen,
  onSnoozeOpenChange,
  onToggleRead,
  onRemove,
  onSnooze,
  onUnsnooze,
  onOpen,
  onApprove,
  approving,
}: InboxPane.Props) {
  const clientLink = useClientLink()
  const announce = useAnnounce()
  const { title } = notificationText(item)
  const note = notificationNote(item)
  const target = notificationTarget(item)
  const link = target ? clientLink(target) : undefined
  const canApprove = awaitsYourReview(item)
  const context = [item.team?.name, item.build ? `#${item.build.number}` : undefined]
    .filter(Boolean)
    .join(' · ')

  return (
    <Pane
      label="Notification"
      width="lg"
      {...(context ? { context } : {})}
      actions={
        <>
          <Button
            size="sm"
            variant="ghost"
            aria-keyshortcuts="u"
            onClick={() => onToggleRead(item)}
          >
            {item.readAt ? 'Mark unread' : 'Mark read'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-keyshortcuts="Backspace"
            onClick={() => onRemove(item)}
          >
            Delete
          </Button>
          <span className={styles.spacer} />
          {snoozedTab ? (
            <Button size="sm" onClick={() => onUnsnooze(item)}>
              Unsnooze
            </Button>
          ) : (
            <SnoozeMenu
              allowNextPush={false}
              open={snoozeOpen}
              onOpenChange={onSnoozeOpenChange}
              onSnooze={(choice) => onSnooze(item, choice)}
              trigger={
                <Button size="sm" aria-keyshortcuts="h">
                  Snooze
                </Button>
              }
            />
          )}
          {link ? (
            <Button
              size="sm"
              aria-keyshortcuts="Enter"
              href={link.href}
              onClick={(event) => {
                onOpen(item)
                link.onClick(event)
              }}
            >
              {openLabel(item)}
            </Button>
          ) : null}
          {canApprove ? (
            <Button
              size="sm"
              variant="primary"
              loading={approving}
              aria-keyshortcuts="shift+a"
              onClick={() => onApprove(item)}
            >
              Approve all <Kbd>⇧A</Kbd>
            </Button>
          ) : null}
        </>
      }
    >
      <div className={styles.paneBody}>
        <h3 className={styles.paneTitle}>{title}</h3>
        {item.alsoInReviews ? (
          <div className={styles.also}>
            <Badge shape="tag">Also in Reviews</Badge>
            <span>Approving or rejecting here clears it there too.</span>
          </div>
        ) : null}
        {note ? (
          <blockquote className={styles.quote}>
            {item.actor ? <Avatar type="user" {...item.actor} size={24} /> : null}
            <div className={styles.quoteText}>
              <span className={styles.quoteBy}>
                {item.actor ? `${item.actor.name} ` : null}
                <span className={styles.quoteWhen}>
                  <RelativeTime iso={item.createdAt} />
                </span>
              </span>
              <span>{note}</span>
            </div>
          </blockquote>
        ) : null}
        {item.build ? <BuildDetails item={item} build={item.build} /> : null}
        {replyTarget(item) ? <Reply item={item} onSent={() => announce('Reply sent')} /> : null}
        {systemText(item) ? <p className={styles.systemText}>{systemText(item)}</p> : null}
      </div>
    </Pane>
  )
}

function BuildDetails({
  item,
  build,
}: {
  item: Inbox.Item
  build: NonNullable<Inbox.Item['build']>
}) {
  const { status, label } = buildStatus(build)
  const counts = item.changes ? changeSummary(item.changes) : []
  const overdue = item.request ? overdueLabel(item.request.overdueByMs) : undefined
  const rows: [string, ReactNode][] = [
    [
      'Build',
      <span key="build" className={styles.value}>
        <StatusIcon status={status} size={12} decorative />
        {item.team?.name} #{build.number}
        {build.name === 'default' ? '' : ` · ${build.name}`} · {label}
      </span>,
    ],
    [
      'Branch',
      <span key="branch" className={styles.mono}>
        {build.branch ?? build.commitSha.slice(0, 7)}
      </span>,
    ],
    ...(item.changes
      ? ([
          [
            'Screenshots',
            <span key="shots" className={styles.counts}>
              <span>{counts.length === 0 ? 'No changes' : counts.join(', ')}</span>
              <span className={styles.muted}>{item.changes.unchanged} same</span>
            </span>,
          ],
        ] as [string, ReactNode][])
      : []),
    ...(item.request?.dueAt
      ? ([
          [
            'Review target',
            <span key="target" className={overdue ? styles.late : undefined}>
              {overdue ? `${overdue}, target ` : 'Due '}
              <RelativeTime iso={item.request.dueAt} />
            </span>,
          ],
        ] as [string, ReactNode][])
      : []),
  ]
  return (
    <dl className={styles.details}>
      {rows.map(([name, value]) => (
        <div key={name} className={styles.row}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function Reply({ item, onSent }: { item: Inbox.Item; onSent: () => void }) {
  const reply = useReplyToMention()
  const [body, setBody] = useState('')
  const who = item.actor?.name.split(' ')[0]
  return (
    <form
      className={styles.reply}
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = body.trim()
        if (!trimmed) return
        reply.mutate(
          { item, body: trimmed },
          {
            onSuccess: () => {
              setBody('')
              onSent()
            },
          },
        )
      }}
    >
      <TextField
        label="Reply"
        hideLabel
        value={body}
        placeholder={who ? `Reply to ${who}…` : 'Reply…'}
        error={reply.error?.message}
        onChange={(event) => setBody(event.target.value)}
      />
      <Button type="submit" size="sm" loading={reply.isPending} disabled={!body.trim()}>
        Reply
      </Button>
    </form>
  )
}

export namespace InboxPane {
  export interface Props {
    item: Inbox.Item
    snoozedTab: boolean
    snoozeOpen: boolean
    onSnoozeOpenChange: (open: boolean) => void
    onToggleRead: (item: Inbox.Item) => void
    onRemove: (item: Inbox.Item) => void
    onSnooze: (item: Inbox.Item, choice: SnoozeChoice) => void
    onUnsnooze: (item: Inbox.Item) => void
    /** The Open button was used: the page marks the notification read. */
    onOpen: (item: Inbox.Item) => void
    onApprove: (item: Inbox.Item) => void
    approving: boolean
  }
}
