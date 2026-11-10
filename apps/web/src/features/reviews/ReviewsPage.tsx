import type { Review, Undo } from '@circi/api'
import { Button, Kbd, PanePlaceholder, PullRequestIcon, Text } from '@circi/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useState } from 'react'

import { PushPrompt } from '#features/pwa/PushPrompt.tsx'
import { useCrumbNames } from '#features/teams/crumb-names.ts'
import { authClient } from '#lib/auth-client.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { findIn, useFindParam } from '#lib/find.ts'
import { FindField } from '#lib/FindField.tsx'
import { focusRow, leavesKeyToFocus, nextAfterRemoval } from '#lib/list-keys.ts'
import { crumbsFor, PageHeading } from '#lib/PageHeading.tsx'
import { PaneHandle, paneVars } from '#lib/PaneHandle.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'
import { RelativeTime } from '#lib/RelativeTime.tsx'
import { copyLinkItem, menuEntries, openInNewTabItem, snoozeItems } from '#lib/row-menu.ts'
import { useShortcutHandlers } from '#lib/shortcuts.ts'
import { SnoozeMenu } from '#lib/SnoozeMenu.tsx'
import { usePaneWidth } from '#lib/stores/pane-store.ts'
import type { ToastInput } from '#lib/stores/toast-store.ts'
import { toast } from '#lib/toast.ts'
import { refreshAll, withUndo } from '#lib/undo.ts'
import { useClientLink } from '#lib/use-client-link.ts'
import { useListNavigation } from '#lib/use-list-navigation.ts'

import {
  firstName,
  groupRequests,
  isWaitingOnOther,
  requestName,
  isProcessing,
  requestFields,
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
  const listWidth = usePaneWidth('reviews-list')
  useDocumentTitle('Reviews')
  const { workspace } = useParams({ from: ROUTE })
  const { tab, review } = useSearch({ from: ROUTE })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
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
  const [find, setFind] = useFindParam()
  const inThisWorkspace = (data?.requests ?? []).filter((r) => r.workspace.slug === workspace)
  const requests = findIn(inThisWorkspace, find, requestFields)
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
    search: {
      tab: next.tab ?? tab,
      ...(next.review ? { review: next.review } : {}),
      ...(find.trim() ? { q: find.trim() } : {}),
    },
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

  /** Runs `act` for a request about to leave the list; once done, shows its toast and selects the next. */
  const settle = (r: Review.Request, act: (done: (input: ToastInput) => void) => void) => {
    const next = nextAfterRemoval(items, (item) => item.id, r.id)
    act((input) => {
      toast.show(input)
      select(next)
      if (next) focusRow(document.getElementById('reviews-list'), next)
    })
  }
  // Approving and snoozing act at once and the toast offers Undo (the server takes them back).
  const undoable = (r: Review.Request, message: string, undo: Undo.Token | null) =>
    withUndo(
      message,
      undo,
      { workspace: r.workspace.slug, team: r.team.slug },
      refreshAll(queryClient),
    )
  const doApprove = (r: Review.Request) =>
    settle(r, (done) =>
      approve.mutate(r, {
        onSuccess: (answer) => done(undoable(r, `Approved ${requestName(r)}`, answer.undo)),
      }),
    )
  const doSnooze = (r: Review.Request, choice: Parameters<typeof snooze.mutate>[0]['choice']) =>
    settle(r, (done) =>
      snooze.mutate(
        { request: r, choice },
        { onSuccess: (answer) => done(undoable(r, `Snoozed ${requestName(r)}`, answer.undo)) },
      ),
    )
  // Bringing it back and dismissing have no Undo: the server keeps nothing to take them back with.
  const doUnsnooze = (r: Review.Request) =>
    settle(r, (done) =>
      unsnooze.mutate(r, { onSuccess: () => done({ message: `Brought back ${requestName(r)}` }) }),
    )
  const doDismiss = (r: Review.Request) =>
    settle(r, (done) =>
      dismiss.mutate(r, { onSuccess: () => done({ message: `Dismissed ${requestName(r)}` }) }),
    )

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
        toast(`Nudged ${r.reviewer.name}`)
      },
    })

  /** A row's right-click menu: the header's buttons and the keys, for that request (the selection stays as it is). */
  const rowMenu = (r: Review.Request) => {
    const waitingOnOther = isWaitingOnOther(r, userId)
    const canApprove =
      !waitingOnOther && tab !== 'created' && tab !== 'reviewed' && !isProcessing(r.build)
    const href = clientLink({
      to: '/$workspace/$team/builds/$number',
      params: { workspace: r.workspace.slug, team: r.team.slug, number: String(r.build.number) },
    }).href
    return menuEntries([
      { label: 'Open review', onSelect: () => openBuild(r) },
      openInNewTabItem(href),
      copyLinkItem(href),
      canApprove && { label: 'Approve', onSelect: () => doApprove(r) },
      ...(tab === 'for-you' ? snoozeItems(true, (choice) => doSnooze(r, choice)) : []),
      tab === 'snoozed' && { label: 'Unsnooze', onSelect: () => doUnsnooze(r) },
      waitingOnOther &&
        !nudged.has(r.id) && {
          label: `Nudge ${firstName(r.reviewer.name)}`,
          onSelect: () => doNudge(r),
        },
    ])
  }

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
        find={<FindField noun="reviews" value={find} onChange={setFind} />}
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
      <PushPrompt hasReview={pending > 0} />
      <QueryBoundary query={query} announce="Loading reviews" rows={4}>
        {() => (
          <div
            className={styles.layout}
            data-selected={selected ? 'true' : 'false'}
            style={paneVars({ '--circi-reviews-width': ['reviews-list', listWidth] })}
          >
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
              find={find}
              onFind={setFind}
              hasRequests={inThisWorkspace.length > 0}
              linkTo={(id) => clientLink(searchFor({ review: id }))}
              rowMenu={rowMenu}
              onTab={(next) =>
                void navigate({
                  ...searchFor({ tab: next }),
                  search: { tab: next, ...(find.trim() ? { q: find.trim() } : {}) },
                })
              }
            />
            <PaneHandle
              pane="reviews-list"
              cssVar="--circi-reviews-width"
              at="var(--circi-reviews-width)"
            />
            <section className={styles.detail} aria-label="Selected review">
              {failed ? (
                <Text tone="failed" role="alert">
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
              ) : items.length > 0 ? (
                <PanePlaceholder
                  icon={<PullRequestIcon />}
                  detail="Pick a build from the list to read it here."
                  hint={
                    <>
                      <Kbd>J</Kbd> <Kbd>K</Kbd> move through the list · <Kbd>↵</Kbd> open the review
                    </>
                  }
                >
                  Select a review
                </PanePlaceholder>
              ) : null}
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
            {
              onSuccess: (answer) =>
                toast.show(
                  answer.requests[0]?.created
                    ? undoable(selected, `Asked ${member.name} to review`, answer.undo)
                    : { message: `${member.name} already asked` },
                ),
            },
          )
        }}
      />
    </>
  )
}
