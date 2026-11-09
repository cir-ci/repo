import type { Review } from '@circi/api'
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  ListRow,
  Pane,
  ReviewIcon,
  Text,
  useAnnounce,
  TabList,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useState } from 'react'

import { useDocumentTitle } from '#lib/document-title.ts'
import { PageHeading } from '#lib/PageHeading.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'
import { RelativeTime } from '#lib/RelativeTime.tsx'
import { useShortcutHandlers } from '#lib/shortcuts.ts'
import { SnoozeMenu } from '#lib/SnoozeMenu.tsx'
import { useClientLink } from '#lib/use-client-link.ts'
import { useSelectableList } from '#lib/use-selectable-list.ts'

import {
  overdueLabel,
  requestCount,
  requestName,
  requestRef,
  REVIEW_TABS,
  reviewsQuery,
  useApproveRequest,
  useDismissRequest,
  useRequestReview,
  useSnoozeRequest,
  useUnsnoozeRequest,
} from './api.ts'
import { MemberPicker } from './MemberPicker.tsx'

import styles from '#lib/ListPage.module.css'

export function ReviewsPage() {
  useDocumentTitle('Reviews')
  const { workspace } = useParams({ from: '/workspaces/$workspace/reviews' })
  const { tab } = useSearch({ from: '/workspaces/$workspace/reviews' })
  const navigate = useNavigate()
  const announce = useAnnounce()
  const clientLink = useClientLink()
  const query = useQuery(reviewsQuery(tab))
  const { data } = query

  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const [picking, setPicking] = useState(false)

  const approve = useApproveRequest()
  const snooze = useSnoozeRequest()
  const unsnooze = useUnsnoozeRequest()
  const dismiss = useDismissRequest()
  const requestReview = useRequestReview()

  // This page is one workspace's reviews; the list spans all of the person's.
  const requests = (data?.requests ?? []).filter((r) => r.workspace.slug === workspace)
  const can = { approve: tab !== 'created', snooze: tab === 'for-you', unsnooze: tab === 'snoozed' }

  const openSelected = (r: Review.Request) =>
    void navigate({
      to: '/$workspace/$team/builds/$number',
      params: { workspace: r.workspace.slug, team: r.team.slug, number: String(r.build.number) },
    })

  const { selected, setSelectedId, peek, listRef, rowProps, settle } = useSelectableList({
    items: requests,
    getId: (r) => r.id,
    onOpen: openSelected,
  })

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
    snooze: () => {
      if (selected && can.snooze) setSnoozeOpen(true)
    },
    requestReview: () => {
      if (selected) setPicking(true)
    },
  })

  const failed = [approve, snooze, unsnooze, dismiss, requestReview].find((m) => m.error)?.error

  return (
    <>
      <PageHeading title="Reviews" />
      <div className={styles.page}>
        <TabList
          label="Reviews"
          tabs={REVIEW_TABS}
          value={tab}
          onChange={(next) => {
            setSelectedId(undefined)
            void navigate({
              to: '/workspaces/$workspace/reviews',
              params: { workspace },
              search: { tab: next },
              replace: true,
            })
          }}
        >
          <div className={styles.body}>
            <QueryBoundary query={query} announce="Loading reviews" rows={4}>
              {() =>
                requests.length === 0 ? (
                  <EmptyState icon={<ReviewIcon size={32} />} title={EMPTY[tab].title}>
                    {EMPTY[tab].text}
                  </EmptyState>
                ) : (
                  <>
                    <div className={styles.toolbar}>
                      <span role="status" className={styles.count}>
                        {requestCount(requests.length)}
                      </span>
                      {selected && can.approve ? (
                        <Button
                          size="sm"
                          variant="primary"
                          loading={approve.isPending}
                          onClick={() => doApprove(selected)}
                        >
                          Approve
                        </Button>
                      ) : null}
                      {selected && can.snooze ? (
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
                      {selected && can.unsnooze ? (
                        <Button size="sm" onClick={() => doUnsnooze(selected)}>
                          Unsnooze
                        </Button>
                      ) : null}
                      {selected ? (
                        <Button
                          size="sm"
                          aria-keyshortcuts="shift+r"
                          onClick={() => setPicking(true)}
                        >
                          Request review
                        </Button>
                      ) : null}
                      {selected ? (
                        <Button size="sm" onClick={() => doDismiss(selected)}>
                          Dismiss
                        </Button>
                      ) : null}
                    </div>
                    {failed ? (
                      <Text tone="rejected" role="alert">
                        {failed.message}
                      </Text>
                    ) : null}
                    <div className={styles.split}>
                      <ul
                        aria-label={REVIEW_TABS.find((t) => t.value === tab)?.label ?? 'Reviews'}
                        className={styles.list}
                        ref={listRef}
                      >
                        {requests.map((r) => {
                          const overdue = overdueLabel(r.overdueByMs)
                          const person = tab === 'created' ? r.reviewer : r.requestedBy
                          return (
                            <li key={r.id} {...rowProps(r.id)}>
                              <ListRow
                                density="two-line"
                                selected={r.id === selected?.id}
                                {...clientLink({
                                  to: '/$workspace/$team/builds/$number',
                                  params: {
                                    workspace: r.workspace.slug,
                                    team: r.team.slug,
                                    number: String(r.build.number),
                                  },
                                })}
                                leading={person ? <Avatar name={person.name} /> : undefined}
                                trailing={
                                  <span className={styles.trailing}>
                                    {overdue ? (
                                      <Badge tone="state" state="rejected" shape="tag">
                                        {overdue}
                                      </Badge>
                                    ) : null}
                                    {r.snoozedUntil ? (
                                      <Text variant="small" tone="secondary">
                                        Until <RelativeTime iso={r.snoozedUntil} />
                                      </Text>
                                    ) : null}
                                  </span>
                                }
                              >
                                <span className={styles.title}>
                                  <Text truncate>
                                    Build #{r.build.number} · {r.team.name}
                                  </Text>
                                  <Text variant="mono" tone="secondary" truncate>
                                    {requestRef(r.build)}
                                  </Text>
                                </span>
                                <span className={styles.meta}>
                                  <span>
                                    {tab === 'created'
                                      ? `Asked of ${r.reviewer.name}`
                                      : r.requestedBy
                                        ? `Requested by ${r.requestedBy.name}`
                                        : 'Requested'}
                                  </span>
                                  <RelativeTime iso={r.createdAt} />
                                </span>
                              </ListRow>
                            </li>
                          )
                        })}
                      </ul>
                      {peek && selected ? (
                        <Pane
                          label="Preview"
                          context={`#${selected.build.number}`}
                          actions={
                            <Button
                              size="sm"
                              variant="primary"
                              {...clientLink({
                                to: '/$workspace/$team/builds/$number',
                                params: {
                                  workspace: selected.workspace.slug,
                                  team: selected.team.slug,
                                  number: String(selected.build.number),
                                },
                              })}
                            >
                              Open build
                            </Button>
                          }
                        >
                          <RequestDetail request={selected} />
                        </Pane>
                      ) : null}
                    </div>
                  </>
                )
              }
            </QueryBoundary>
          </div>
        </TabList>
      </div>
      <MemberPicker
        workspace={workspace}
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

const EMPTY: Record<Review.Tab, { title: string; text: string }> = {
  'for-you': { title: 'Nothing to review', text: 'Review requests asked of you appear here.' },
  created: { title: 'No requests from you', text: 'Reviews you ask others for appear here.' },
  snoozed: { title: 'Nothing snoozed', text: 'Requests you put off wait here until they wake.' },
}

function RequestDetail({ request: r }: { request: Review.Request }) {
  return (
    <div className={styles.detail}>
      <Text>
        {r.team.name} · build #{r.build.number}
      </Text>
      <dl>
        <dt>Branch</dt>
        <dd>{requestRef(r.build)}</dd>
        <dt>Commit</dt>
        <dd>{r.build.commitSha.slice(0, 7)}</dd>
        <dt>Requested by</dt>
        <dd>{r.requestedBy?.name ?? 'Someone who has left'}</dd>
        <dt>Reviewer</dt>
        <dd>{r.reviewer.name}</dd>
        {r.dueAt ? (
          <>
            <dt>Due</dt>
            <dd>
              <RelativeTime iso={r.dueAt} />
            </dd>
          </>
        ) : null}
      </dl>
    </div>
  )
}
