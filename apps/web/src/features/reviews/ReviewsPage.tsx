import type { Review } from '@circi/api'
import { Button, Kbd, ReviewIcon, Text, useAnnounce } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useState } from 'react'

import { useCrumbNames } from '#features/teams/crumb-names.ts'
import { authClient } from '#lib/auth-client.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { focusRow, leavesKeyToFocus, nextAfterRemoval } from '#lib/list-keys.ts'
import { crumbsFor, PageHeading } from '#lib/PageHeading.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'
import { RelativeTime } from '#lib/RelativeTime.tsx'
import { useShortcutHandlers } from '#lib/shortcuts.ts'
import { SnoozeMenu } from '#lib/SnoozeMenu.tsx'
import { useClientLink } from '#lib/use-client-link.ts'
import { useListNavigation } from '#lib/use-list-navigation.ts'

import {
  firstName,
  groupRequests,
  isWaitingOnOther,
  requestName,
  isProcessing,
  reviewsQuery,
  useApproveRequest,
  useDismissRequest,
  useNudgeRequest,
  useRequestReview,
  useSnoozeRequest,
  useUnsnoozeRequest,
} from './api.ts'
import { MemberPicker } from './MemberPicker.tsx'
import { ReviewDetail } from './ReviewDetail.tsx'
import { ReviewList } from './ReviewList.tsx'

import styles from './Reviews.module.css'

const ROUTE = '/workspaces/$workspace/reviews' as const

/**
 * Reviews, Linear style: the list of review requests (340px) beside the selected one. The
 * selection is the `?review=` of the address, so it can be linked; J / K move it, Enter opens the
 * build. On a phone the list and the review take turns.
 */
export function ReviewsPage() {
  useDocumentTitle('Reviews')
  const { workspace } = useParams({ from: ROUTE })
  const { tab, review } = useSearch({ from: ROUTE })
  const navigate = useNavigate()
  const announce = useAnnounce()
  const clientLink = useClientLink()
  const { data: session } = authClient.useSession()
  const userId = session?.user.id
  const query = useQuery(reviewsQuery(tab))
  const { data } = query
  const names = useCrumbNames(workspace)
  // The counts beside "Reviews" and the tabs are the same whichever tab is open.
  const forYou = useQuery({ ...reviewsQuery('for-you'), enabled: tab !== 'for-you' })
  const snoozedList = useQuery({ ...reviewsQuery('snoozed'), enabled: tab !== 'snoozed' })
  const inWorkspace = (list: { requests: Review.Request[] } | undefined) =>
    (list?.requests ?? []).filter((r) => r.workspace.slug === workspace).length
  const pending = inWorkspace(tab === 'for-you' ? data : forYou.data)
  const snoozedCount = inWorkspace(tab === 'snoozed' ? data : snoozedList.data)

  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const [picking, setPicking] = useState(false)

  const approve = useApproveRequest()
  const snooze = useSnoozeRequest()
  const unsnooze = useUnsnoozeRequest()
  const dismiss = useDismissRequest()
  const requestReview = useRequestReview()
  const nudge = useNudgeRequest()
  const [nudged, setNudged] = useState<ReadonlySet<string>>(new Set())

  // This page is one workspace's reviews; the list spans all of the person's.
  const requests = (data?.requests ?? []).filter((r) => r.workspace.slug === workspace)
  const groups = groupRequests(requests, tab, userId)
  const items = groups.flatMap((g) => g.items)
  // No review in the address means none is selected: the panel invites a choice.
  const selected = items.find((r) => r.id === review)
  const waiting = selected !== undefined && isWaitingOnOther(selected, userId)
  const can = {
    approve:
      !waiting &&
      tab !== 'created' &&
      tab !== 'reviewed' &&
      selected !== undefined &&
      !isProcessing(selected.build),
    snooze: tab === 'for-you',
    unsnooze: tab === 'snoozed',
  }

  const searchFor = (next: { tab?: Review.Tab; review?: string }) => ({
    to: ROUTE,
    params: { workspace },
    search: { tab: next.tab ?? tab, ...(next.review ? { review: next.review } : {}) },
  })
  const select = (id: string | undefined, replace = true) =>
    void navigate({ ...searchFor(id ? { review: id } : {}), replace })

  const { listRef, rowProps } = useListNavigation({
    items,
    getId: (r) => r.id,
    selectedId: selected?.id,
    onSelect: (r) => select(r.id),
  })

  const openBuild = (r: Review.Request) =>
    void navigate({
      to: '/$workspace/$team/builds/$number',
      params: { workspace: r.workspace.slug, team: r.team.slug, number: String(r.build.number) },
    })

  /** Runs `act` for a request about to leave the list; once done, announces and selects the next. */
  const settle = (r: Review.Request, message: string, act: (done: () => void) => void) => {
    const next = nextAfterRemoval(items, (item) => item.id, r.id)
    act(() => {
      announce(message)
      select(next)
      if (next) focusRow(document.getElementById('reviews-list'), next)
    })
  }
  const doApprove = (r: Review.Request) =>
    settle(r, `Approved ${requestName(r)}`, (done) => approve.mutate(r, { onSuccess: done }))
  const doSnooze = (r: Review.Request, choice: Parameters<typeof snooze.mutate>[0]['choice']) =>
    settle(r, `Snoozed ${requestName(r)}`, (done) =>
      snooze.mutate({ request: r, choice }, { onSuccess: done }),
    )
  const doUnsnooze = (r: Review.Request) =>
    settle(r, `Brought back ${requestName(r)}`, (done) => unsnooze.mutate(r, { onSuccess: done }))
  const doDismiss = (r: Review.Request) =>
    settle(r, `Dismissed ${requestName(r)}`, (done) => dismiss.mutate(r, { onSuccess: done }))

  useShortcutHandlers({
    // Enter on a row opens the build (the row's own link would only select it); on a button
    // or a link elsewhere it keeps its meaning.
    open: (_action, event) => {
      const inRow = event.target instanceof Element && event.target.closest('[data-row-id]')
      if ((!inRow && leavesKeyToFocus(event)) || !selected) return false
      openBuild(selected)
      return undefined
    },
    snooze: () => {
      if (selected && can.snooze) setSnoozeOpen(true)
    },
    requestReview: () => {
      if (selected && !waiting) setPicking(true)
    },
  })

  const doNudge = (r: Review.Request) =>
    nudge.mutate(r, {
      onSuccess: () => {
        setNudged((ids) => new Set(ids).add(r.id))
        announce(`Nudged ${r.reviewer.name}`)
      },
    })

  const failed = [approve, snooze, unsnooze, dismiss, requestReview, nudge].find(
    (m) => m.error,
  )?.error
  const buildLink = selected
    ? clientLink({
        to: '/$workspace/$team/builds/$number',
        params: {
          workspace: selected.workspace.slug,
          team: selected.team.slug,
          number: String(selected.build.number),
        },
      })
    : undefined
  const back = clientLink(searchFor({}))

  return (
    <>
      <PageHeading
        crumbs={crumbsFor(names)}
        title="Reviews"
        actions={
          selected ? (
            <>
              {waiting ? (
                <>
                  <span className={styles.waiting}>
                    Waiting on {selected.reviewer.name} · requested{' '}
                    <RelativeTime iso={selected.createdAt} />
                  </span>
                  <Button
                    size="sm"
                    disabled={nudged.has(selected.id)}
                    loading={nudge.isPending}
                    onClick={() => doNudge(selected)}
                  >
                    {nudged.has(selected.id)
                      ? 'Nudged'
                      : `Nudge ${firstName(selected.reviewer.name)}`}
                  </Button>
                </>
              ) : null}
              {can.snooze ? (
                <SnoozeMenu
                  open={snoozeOpen}
                  onOpenChange={setSnoozeOpen}
                  onSnooze={(choice) => doSnooze(selected, choice)}
                  trigger={
                    <Button size="sm" aria-keyshortcuts="h">
                      Snooze
                    </Button>
                  }
                />
              ) : null}
              {buildLink ? (
                <Button size="sm" {...buildLink}>
                  Open review
                </Button>
              ) : null}
              {tab !== 'created' && tab !== 'reviewed' && !waiting ? (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!can.approve}
                  loading={approve.isPending}
                  onClick={() => doApprove(selected)}
                >
                  Approve all
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />
      <QueryBoundary query={query} announce="Loading reviews" rows={4}>
        {() => (
          <div className={styles.layout} data-selected={selected ? 'true' : 'false'}>
            <ReviewList
              workspace={workspace}
              userId={userId}
              tab={tab}
              pending={pending}
              snoozed={snoozedCount}
              groups={groups}
              selectedId={selected?.id}
              listRef={listRef}
              rowProps={rowProps}
              linkTo={(id) => clientLink(searchFor({ review: id }))}
              onTab={(next) =>
                void navigate({ ...searchFor({ tab: next }), search: { tab: next } })
              }
            />
            <section className={styles.detail} aria-label="Selected review">
              {failed ? (
                <Text tone="rejected" role="alert">
                  {failed.message}
                </Text>
              ) : null}
              {selected ? (
                <ReviewDetail request={selected} backHref={back.href} onBack={back.onClick}>
                  {can.unsnooze ? (
                    <Button size="sm" onClick={() => doUnsnooze(selected)}>
                      Unsnooze
                    </Button>
                  ) : null}
                  {waiting ? null : (
                    <Button size="sm" aria-keyshortcuts="shift+r" onClick={() => setPicking(true)}>
                      Request review
                    </Button>
                  )}
                  {tab === 'reviewed' || waiting ? null : (
                    <Button size="sm" onClick={() => doDismiss(selected)}>
                      Dismiss
                    </Button>
                  )}
                </ReviewDetail>
              ) : (
                <div className={styles.empty}>
                  <ReviewIcon size={40} />
                  <p className={styles.emptyTitle}>
                    {items.length === 0 ? 'All caught up' : 'Select a review'}
                  </p>
                  <p className={styles.emptyText}>
                    {items.length === 0
                      ? 'Nothing is waiting on you. New review requests appear in the list on the left.'
                      : 'Pick a build from the list to read it here.'}
                  </p>
                  <span className={styles.hints}>
                    <Kbd>J</Kbd> <Kbd>K</Kbd> move through the list · <Kbd>↵</Kbd> open the review
                  </span>
                </div>
              )}
            </section>
          </div>
        )}
      </QueryBoundary>
      <MemberPicker
        workspace={workspace}
        team={selected?.team.slug}
        open={picking}
        onOpenChange={setPicking}
        onPick={(member) => {
          if (!selected) return
          requestReview.mutate(
            { request: selected, reviewerId: member.id },
            { onSuccess: () => announce(`Asked ${member.name} to review`) },
          )
        }}
      />
    </>
  )
}
