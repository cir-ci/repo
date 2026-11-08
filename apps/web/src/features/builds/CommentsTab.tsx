import type { Comment } from '@circi/api'
import { Avatar, Banner, Button, EmptyState, ReviewIcon, Text, useAnnounce } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { type Ref, useEffect, useRef, useState } from 'react'

import { organizationQuery } from '#features/members/api.ts'
import { RelativeTime } from '#lib/RelativeTime.tsx'

import { Composer } from './Composer.tsx'
import { commentsQuery, useAddComment, useDeleteComment, useEditComment } from './discussion-api.ts'
import type { MentionMember } from './mentions.ts'
import { regionThreads } from './regions.ts'
import { groupThreads, type Thread } from './timeline.ts'

import styles from './Discussion.module.css'

/**
 * The build's discussion: threads with replies, a field for a new comment (the C key focuses
 * it) and, when a region was just drawn on a snapshot, the comment is pinned to it.
 */
export function CommentsTab(props: CommentsTab.Props) {
  const { org, project, number, snapshotName, pendingRegion, focusedId } = props
  const { data, error, isPending } = useQuery(commentsQuery(org, project, number))
  const organization = useQuery(organizationQuery(org))
  const add = useAddComment(org, project, number)
  const announce = useAnnounce()

  const members: MentionMember[] = (organization.data?.members ?? []).map((m) => ({
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
  }))
  const comments = data?.comments ?? []
  const threads = groupThreads(comments)
  // Pinned threads are numbered as their markers are on the snapshot.
  const numbering = new Map(
    snapshotName ? regionThreads(comments, snapshotName).map((c, i) => [c.id, i + 1]) : [],
  )

  return (
    <>
      <Composer
        members={members}
        label="Comment"
        submitLabel="Comment"
        inputRef={props.composerRef}
        pending={add.isPending}
        error={add.error?.message}
        context={
          pendingRegion && snapshotName ? (
            <div className={styles.line}>
              <Text variant="small">Pinned to a region of {snapshotName}</Text>
              <Button size="sm" variant="ghost" onClick={props.onClearRegion}>
                Remove pin
              </Button>
            </div>
          ) : null
        }
        onSubmit={(body, clear) =>
          add.mutate(
            {
              body,
              ...(pendingRegion && snapshotName ? { snapshotName, region: pendingRegion } : {}),
            },
            {
              onSuccess: () => {
                clear()
                props.onClearRegion()
                announce('Comment added.')
              },
            },
          )
        }
      />
      {error ? <Banner tone="danger">{error.message}</Banner> : null}
      {isPending ? (
        <Text tone="secondary" role="status">
          Loading comments…
        </Text>
      ) : threads.length === 0 ? (
        <EmptyState icon={<ReviewIcon size={28} />} title="No comments yet">
          Press C to write one, or drag over a snapshot to comment on a region.
        </EmptyState>
      ) : (
        <div className={styles.list} role="list" aria-label="Comments">
          {threads.map((t) => (
            <ThreadView
              key={t.root.id}
              thread={t}
              members={members}
              number={numbering.get(t.root.id)}
              focused={t.root.id === focusedId}
              org={org}
              project={project}
              build={number}
              onShow={props.onShowSnapshot}
            />
          ))}
        </div>
      )}
    </>
  )
}

export namespace CommentsTab {
  export interface Props {
    org: string
    project: string
    number: number
    /** The snapshot on screen: a region drawn on it is pinned to this name. */
    snapshotName: string | null
    pendingRegion: Comment.Region | null
    onClearRegion: () => void
    /** The thread to scroll to and focus (a marker or an activity line was chosen). */
    focusedId: string | null
    composerRef: Ref<HTMLTextAreaElement>
    /** A pinned comment's snapshot chip: show that snapshot and mark the thread. */
    onShowSnapshot: (snapshotName: string, commentId: string) => void
  }
}

function ThreadView({
  thread,
  members,
  number,
  focused,
  org,
  project,
  build,
  onShow,
}: ThreadView.Props) {
  const [replying, setReplying] = useState(false)
  const add = useAddComment(org, project, build)
  const { root, replies } = thread
  const card = useRef<HTMLDivElement>(null)
  // A marker or an activity line points here: scroll to the thread and move focus into it.
  useEffect(() => {
    if (!focused) return
    card.current?.focus()
    card.current?.scrollIntoView({ block: 'nearest' })
  }, [focused])
  return (
    <div
      ref={card}
      role="listitem"
      className={styles.thread}
      data-thread-id={root.id}
      data-focused={focused ? '' : undefined}
      tabIndex={-1}
    >
      <CommentView comment={root} members={members} org={org} project={project} build={build}>
        {root.snapshotName && root.region ? (
          <button
            type="button"
            className={styles.pin}
            onClick={() => root.snapshotName && onShow(root.snapshotName, root.id)}
          >
            {number ? `${number} · ` : ''}
            {root.snapshotName}
          </button>
        ) : null}
      </CommentView>
      {replies.map((r) => (
        <div key={r.id} className={styles.reply}>
          <CommentView comment={r} members={members} org={org} project={project} build={build} />
        </div>
      ))}
      {replying ? (
        <div className={styles.reply}>
          <Composer
            members={members}
            label="Reply"
            submitLabel="Reply"
            pending={add.isPending}
            error={add.error?.message}
            onCancel={() => setReplying(false)}
            onSubmit={(body) =>
              add.mutate({ body, parentId: root.id }, { onSuccess: () => setReplying(false) })
            }
          />
        </div>
      ) : (
        <div className={styles.reply}>
          <Button size="sm" variant="ghost" onClick={() => setReplying(true)}>
            Reply
          </Button>
        </div>
      )}
    </div>
  )
}

namespace ThreadView {
  export interface Props {
    thread: Thread
    members: readonly MentionMember[]
    number: number | undefined
    focused: boolean
    org: string
    project: string
    build: number
    onShow: (snapshotName: string, commentId: string) => void
  }
}

function CommentView({ comment, members, org, project, build, children }: CommentView.Props) {
  const [editing, setEditing] = useState(false)
  const edit = useEditComment(org, project, build)
  const remove = useDeleteComment(org, project, build)
  const name = comment.author?.name ?? 'Someone who has left'
  const deleted = comment.deletedAt !== null
  return (
    <div className={styles.comment}>
      <Avatar name={name} />
      <div className={styles.eventBody}>
        <div className={styles.line}>
          <Text>
            <strong>{name}</strong>
          </Text>
          <Text variant="small" tone="tertiary">
            <RelativeTime iso={comment.createdAt} />
            {comment.editedAt ? ' (edited)' : ''}
          </Text>
          {children}
        </div>
        {deleted ? (
          <Text tone="tertiary">This comment was deleted.</Text>
        ) : editing ? (
          <Composer
            members={members}
            label="Edit comment"
            initial={comment.body}
            submitLabel="Save"
            pending={edit.isPending}
            error={edit.error?.message}
            onCancel={() => setEditing(false)}
            onSubmit={(body) =>
              edit.mutate({ id: comment.id, body }, { onSuccess: () => setEditing(false) })
            }
          />
        ) : (
          <p className={styles.commentBody}>
            <Text>{comment.body}</Text>
          </p>
        )}
        {!deleted && !editing && (comment.mine || comment.canDelete) ? (
          <div className={styles.actions}>
            {comment.mine ? (
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                Edit
              </Button>
            ) : null}
            {comment.canDelete ? (
              <Button
                size="sm"
                variant="ghost"
                loading={remove.isPending}
                onClick={() => remove.mutate(comment.id)}
              >
                Delete
              </Button>
            ) : null}
          </div>
        ) : null}
        {remove.error ? (
          <Text variant="small" tone="rejected" role="alert">
            {remove.error.message}
          </Text>
        ) : null}
      </div>
    </div>
  )
}

namespace CommentView {
  export interface Props {
    comment: Comment.Item
    members: readonly MentionMember[]
    org: string
    project: string
    build: number
    children?: React.ReactNode
  }
}
