import type { Comment } from '@circi/api'
import { Avatar, Banner, Button, EmptyState, ReviewIcon, Text, useAnnounce } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { Fragment, type Ref, useEffect, useRef, useState } from 'react'

import {
  commentsQuery,
  useAddComment,
  useDeleteComment,
  useEditComment,
  useMentionMembers,
} from '#features/builds/api/discussion.ts'
import { regionThreads } from '#features/regions/geometry.ts'
import { type Mention, splitMentions } from '#lib/mentions.ts'
import { RelativeTime } from '#lib/RelativeTime.tsx'

import { Composer } from './Composer.tsx'
import { groupThreads, type Thread } from './timeline.ts'

import styles from './Discussion.module.css'

/**
 * The build's discussion: threads with replies and a field for a new comment (the C key
 * focuses it). A comment on a region is written in the popover on the image, not here.
 */
export function CommentsTab(props: CommentsTab.Props) {
  const { workspace, team, number, snapshotName, focusedId } = props
  const { data, error, isPending } = useQuery(commentsQuery(workspace, team, number))
  const members = useMentionMembers(workspace, team)
  const add = useAddComment(workspace, team, number)
  const announce = useAnnounce()

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
        onSubmit={(body, clear) =>
          add.mutate(
            { body },
            {
              onSuccess: () => {
                clear()
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
          Press C to write one, or drag over a screenshot to comment on a region.
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
              workspace={workspace}
              team={team}
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
    workspace: string
    team: string
    number: number
    /** The snapshot on screen: a region drawn on it is pinned to this name. */
    snapshotName: string | null
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
  workspace,
  team,
  build,
  onShow,
}: ThreadView.Props) {
  const [replying, setReplying] = useState(false)
  const add = useAddComment(workspace, team, build)
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
      <CommentView comment={root} members={members} workspace={workspace} team={team} build={build}>
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
          <CommentView
            comment={r}
            members={members}
            workspace={workspace}
            team={team}
            build={build}
          />
        </div>
      ))}
      {replying ? (
        <div className={styles.reply}>
          <Composer
            members={members}
            label="Reply"
            autoFocus
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
    members: readonly Mention.Member[]
    number: number | undefined
    focused: boolean
    workspace: string
    team: string
    build: number
    onShow: (snapshotName: string, commentId: string) => void
  }
}

/** The one face every comment by someone who has left shares. */
const LEFT_MEMBER_ID = 'left-member'

function CommentView({ comment, members, workspace, team, build, children }: CommentView.Props) {
  const [editing, setEditing] = useState(false)
  const edit = useEditComment(workspace, team, build)
  const remove = useDeleteComment(workspace, team, build)
  const name = comment.author?.name ?? 'Someone who has left'
  const deleted = comment.deletedAt !== null
  return (
    <div className={styles.comment}>
      {comment.author ? (
        <Avatar type="user" {...comment.author} />
      ) : (
        <Avatar type="user" id={LEFT_MEMBER_ID} name={name} image={null} />
      )}
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
            autoFocus
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
            <Text>
              {splitMentions(comment.body, members).map((piece) =>
                piece.member ? (
                  <span
                    key={piece.at}
                    className={styles.mention}
                    data-mention=""
                    title={piece.member.name}
                  >
                    @{piece.member.name}
                  </span>
                ) : (
                  <Fragment key={piece.at}>{piece.text}</Fragment>
                ),
              )}
            </Text>
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
          <Text variant="small" tone="failed" role="alert">
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
    members: readonly Mention.Member[]
    workspace: string
    team: string
    build: number
    children?: React.ReactNode
  }
}
