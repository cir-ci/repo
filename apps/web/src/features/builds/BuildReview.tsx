import type { Build } from '@circi/api'
import {
  Banner,
  Button,
  ListGroup,
  EmptyState,
  ImagesIcon,
  Ref,
  Stack,
  StatusIcon,
  Text,
  Tooltip,
  HourglassIcon,
  ReviewIcon,
  useAnnounce,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'

import { ShortcutsDialog } from '#app/ShortcutsDialog.tsx'
import {
  commentsQuery,
  useAddComment,
  useMentionMembers,
  useSetCommentRegion,
} from '#features/builds/api/discussion.ts'
import { flakyQuery, isActive } from '#features/builds/api/index.ts'
import { regionThreads } from '#features/regions/geometry.ts'
import { authClient } from '#lib/auth-client.ts'
import { crumbsFor, PageHeading, teamBuildsCrumb } from '#lib/PageHeading.tsx'
import { PaneHandle, paneVars } from '#lib/PaneHandle.tsx'
import { RouterLink } from '#lib/router-link.ts'
import { isAvailable, SHORTCUTS, useShortcutHandlers } from '#lib/shortcuts.ts'
import { usePaneWidth } from '#lib/stores/pane-store.ts'
import { useListNavigation } from '#lib/use-list-navigation.ts'

import { buildTitle } from './build-title.ts'
import { BuildMeta } from './BuildMeta.tsx'
import { BuildStateLabel } from './BuildStateLabel.tsx'
import { CountsSummary } from './CountsSummary.tsx'
import { screenshotLabel, screenshotStatus, shotDecision, shotReview } from './diff-status.ts'
import { Viewer } from './DiffViewer.tsx'
import { useIgnoreMode } from './ignore-mode.tsx'
import { IssueAction } from './IssueAction.tsx'
import { SnapshotIssues } from './LinkedIssues.tsx'
import { apiSide, draftOf, type RegionDraft } from './region-draft.ts'
import { RequestedReviewers } from './RequestedReviewers.tsx'
import { RequestReviewPicker } from './RequestReviewPicker.tsx'
import {
  defaultShot,
  GROUP_ORDER,
  groupShots,
  isReviewable,
  neighbour,
  orderShots,
  reviewProgress,
  shotBadge,
} from './review-model.ts'
import { ReviewActions, ReviewNote, useReviewControls } from './ReviewActions.tsx'
import { ReviewSidebar, type SidebarTab } from './ReviewSidebar.tsx'
import { ReviewTarget } from './ReviewTarget.tsx'
import { ROUTE, type ViewMode } from './search.ts'
import { threadCounts } from './timeline.ts'

import page from './BuildPage.module.css'
import styles from './BuildReview.module.css'

/**
 * The build review screen (docs/design-gaps.md §7, provisional): the header with the decision,
 * a strip of context, then the screenshot list (240px, its own scroll) beside the viewer.
 */
export function BuildReview({ data, designEnabled = false }: BuildReview.Props) {
  const railWidth = usePaneWidth('build-rail')
  const sideWidth = usePaneWidth('build-discussion')
  const { build, baseline, team } = data
  const params = useParams({ from: ROUTE })
  const search = useSearch({ from: ROUTE })
  const navigate = useNavigate({ from: ROUTE })
  const mode: ViewMode = search.mode ?? 'side'
  const active = isActive(build.status)
  const [helpOpen, setHelpOpen] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [tab, setTab] = useState<SidebarTab>(search.sidebar ?? 'details')
  // The region selected on an image and not yet sent: it belongs to one snapshot and one side.
  const [draft, setDraft] = useState<RegionDraft | null>(null)
  const [draftKey, setDraftKey] = useState(0)
  const [focusedComment, setFocusedComment] = useState<string | null>(null)
  const composer = useRef<HTMLTextAreaElement>(null)

  // Flaky screenshots are set aside, but the page works without knowing them.
  const { data: flakyReport } = useQuery({
    ...flakyQuery(team.workspaceSlug, team.slug),
    enabled: !active,
  })
  const flaky = useMemo(() => new Set(flakyReport?.flaky.map((f) => f.name) ?? []), [flakyReport])
  const groups = useMemo(() => groupShots(data.diffs, flaky), [data.diffs, flaky])
  const ordered = useMemo(() => orderShots(groups), [groups])
  const fromUrl = search.shot ? ordered.find((d) => d.name === search.shot) : undefined
  const selected = fromUrl ?? defaultShot(groups)
  const selectedGroup = groups.find((g) => selected && g.items.includes(selected))?.kind
  const review = useReviewControls(data, selected)
  const addComment = useAddComment(team.workspaceSlug, team.slug, build.number)
  const setRegion = useSetCommentRegion(team.workspaceSlug, team.slug, build.number)
  const announce = useAnnounce()
  const ignore = useIgnoreMode(team.workspaceSlug, team.slug, selected)
  const members = useMentionMembers(team.workspaceSlug, team.slug)
  const { data: session } = authClient.useSession()
  // Another screenshot has none of this one's regions: the selection and its unsent text go.
  if (draft && draftOf(draft, selected?.id) === null) setDraft(null)

  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(GROUP_ORDER.map((g) => [g.kind, g.open])),
  )
  // Choosing a screenshot (or j / k reaching one) opens its group, so a selection is never hidden.
  const [openedFor, setOpenedFor] = useState<string | undefined>(undefined)
  if (selected?.id !== openedFor) {
    setOpenedFor(selected?.id)
    if (selectedGroup && open[selectedGroup] === false) setOpen({ ...open, [selectedGroup]: true })
  }

  const goToShot = (shot: Build.DiffItem | undefined) => {
    if (shot) void navigate({ search: (prev) => ({ ...prev, shot: shot.name }), replace: true })
  }
  const previous = neighbour(ordered, selected, -1)
  const next = neighbour(ordered, selected, 1)
  const hasPrevious = selected !== undefined && previous !== selected
  const hasNext = selected !== undefined && next !== selected

  // J / K select the next or previous screenshot and move focus to its row with it.
  const { ref: listRef, rowProps } = useListNavigation({
    items: ordered,
    getId: (d) => d.id,
    selectedId: selected?.id,
    onSelect: goToShot,
    // A collapsed group is one stop for J / K (its header): Enter or Right opens it.
    groups: groups.map((g) => ({
      id: g.kind,
      items: g.items,
      collapsed: !(open[g.kind] ?? g.open),
    })),
  })

  const comments = useQuery(commentsQuery(team.workspaceSlug, team.slug, build.number))
  const threads = useMemo(() => threadCounts(comments.data?.comments ?? []), [comments.data])
  const threadCount = (name: string) => threads.get(name) ?? 0
  const pinned = selected ? regionThreads(comments.data?.comments ?? [], selected.name) : []

  // A link to a comment (the inbox's "mentioned you"): once the comments are in, show the
  // thread's snapshot and mark the thread. Done once per link.
  const linked = search.comment
  const [linkedDone, setLinkedDone] = useState<string | undefined>(undefined)
  const allComments = comments.data?.comments
  const linkedComment = linked ? allComments?.find((c) => c.id === linked) : undefined
  const linkedRoot = linkedComment
    ? (allComments?.find((c) => c.id === linkedComment.parentId) ?? linkedComment)
    : undefined
  if (linked && linkedRoot && linkedDone !== linked) {
    setLinkedDone(linked)
    setTab('comments')
    setFocusedComment(linkedRoot.id)
  }
  const linkedShot = linkedRoot?.snapshotName
  const shotShown = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!linked || !linkedShot || shotShown.current === linked) return
    if (!ordered.some((d) => d.name === linkedShot)) return
    shotShown.current = linked
    void navigate({ search: (prev) => ({ ...prev, shot: linkedShot }), replace: true })
  }, [linked, linkedShot, ordered, navigate])

  // C: open the Comments tab and put the cursor in its field once it is on screen.
  const [wantsComposer, setWantsComposer] = useState(0)
  useEffect(() => {
    if (wantsComposer > 0) composer.current?.focus()
  }, [wantsComposer])
  const openComposer = () => {
    setTab('comments')
    setWantsComposer((n) => n + 1)
  }

  useShortcutHandlers({
    mode: (action) => {
      const shortcut = SHORTCUTS.find(
        (s) => s.action.type === 'mode' && s.action.mode === action.mode,
      )
      if (shortcut && !isAvailable(shortcut, designEnabled)) return
      void navigate({ search: (prev) => ({ ...prev, mode: action.mode }), replace: true })
    },
    approve: (_, e) => (e.repeat ? undefined : review.approve()),
    approveAll: (_, e) => (e.repeat ? undefined : review.approveAll()),
    reject: (_, e) => (e.repeat ? undefined : review.askReject()),
    requestReview: (_, e) => (e.repeat ? undefined : setRequesting(true)),
    comment: (_, e) => (e.repeat ? undefined : openComposer()),
    help: () => setHelpOpen(true),
  })

  // Keep the selected row in view in the list's own scroll when j / k (or the buttons) move on.
  const selectedId = selected?.id
  const scrolledFor = useRef(selectedId)
  useEffect(() => {
    if (scrolledFor.current === selectedId) return
    scrolledFor.current = selectedId
    document
      .querySelector('nav[aria-label="Screenshots"] [data-selected]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [selectedId, scrolledFor])

  const hasBaseline = baseline !== null
  const buildReview = shotReview(build)
  const progress = reviewProgress(data.diffs, buildReview)
  return (
    <div className={page['page']}>
      <PageHeading
        crumbs={crumbsFor(
          {
            workspace: { slug: team.workspaceSlug, name: team.workspaceName },
            team: { slug: team.slug, name: team.name },
          },
          [teamBuildsCrumb(team.workspaceSlug, team.slug)],
        )}
        title={buildTitle(build.number, build.name)}
        actions={
          <>
            <BuildStateLabel build={build} hasBaseline={hasBaseline} />
            <ReviewTarget target={data.reviewTarget} />
            <IssueAction data={data} snapshotName={selected?.name ?? null} />
            <RequestedReviewers
              workspace={team.workspaceSlug}
              team={team.slug}
              number={build.number}
            />
            <RequestReviewPicker
              open={requesting}
              onOpenChange={setRequesting}
              trigger={<Button variant="ghost">Request review</Button>}
              workspace={team.workspaceSlug}
              team={team.slug}
              teamName={team.name}
              number={build.number}
            />
            {isReviewable(build) ? (
              <ReviewActions review={review} snapshotName={selected?.name} />
            ) : null}
          </>
        }
        after={build.branch ? <Ref value={build.branch} label="branch name" /> : null}
      />

      <div className={page['context']}>
        <Stack direction="row" gap={3} wrap align="center">
          <BuildMeta build={build} showBranch={false} />
          {active ? null : <CountsSummary counts={build.counts} review={buildReview} />}
          {progress.total > 0 && isReviewable(build) ? (
            <Text variant="small" tone="secondary">
              {progress.reviewed} of {progress.total} reviewed
            </Text>
          ) : null}
        </Stack>
        <ReviewNote data={data} />
        <BaselineNote data={data} />
        {review.error ? <Banner tone="danger">{review.error.message}</Banner> : null}
        {build.errorMessage ? <Banner tone="danger">{build.errorMessage}</Banner> : null}
        {active ? (
          <Banner tone="info">Processing screenshots. This page updates when it's done.</Banner>
        ) : null}
      </div>

      {build.status === 'expired' ? (
        <EmptyState icon={<HourglassIcon />} title="This build has expired">
          Its screenshots were deleted under the team's retention policy.
        </EmptyState>
      ) : ordered.length === 0 ? (
        active ? null : (
          <EmptyState icon={<ImagesIcon />} title="No screenshots in this build">
            The upload contained no PNG files.
          </EmptyState>
        )
      ) : (
        <div
          className={page['body']}
          style={paneVars({
            '--circi-rail-width': ['build-rail', railWidth],
            '--circi-side-width': ['build-discussion', sideWidth],
          })}
        >
          <nav ref={listRef} aria-label="Screenshots" className={page['list']}>
            {groups.map((g) => (
              <div key={g.kind} data-group-id={g.kind} className={styles.group}>
                <ListGroup
                  id={`shots-${g.kind}`}
                  level={3}
                  label={g.title}
                  count={g.items.length}
                  glyph={<StatusIcon status={screenshotStatus(g.kind, 'pending')} decorative />}
                  expanded={open[g.kind] ?? g.open}
                  controls={`shots-${g.kind}-rows`}
                  onExpandedChange={(expanded) => setOpen({ ...open, [g.kind]: expanded })}
                />
                {(open[g.kind] ?? g.open) ? (
                  <ul
                    className={styles.rows}
                    id={`shots-${g.kind}-rows`}
                    aria-labelledby={`shots-${g.kind}`}
                  >
                    {g.items.map((d) => (
                      <li key={d.id} {...rowProps(d.id)}>
                        <RouterLink
                          to={ROUTE}
                          params={params}
                          search={(prev) => ({ ...prev, shot: d.name })}
                          // Current only when chosen in the URL; the default one gets the same
                          // marker through `data-default`.
                          aria-current={d.id === fromUrl?.id ? 'page' : undefined}
                          data-default={!fromUrl && d.id === selected?.id ? '' : undefined}
                          data-selected={d.id === selected?.id ? '' : undefined}
                          className={styles.row}
                        >
                          <StatusIcon
                            status={screenshotStatus(g.kind, shotDecision(d, buildReview))}
                            size={12}
                            label={screenshotLabel(g.kind, shotDecision(d, buildReview))}
                          />
                          <Tooltip content={d.name}>
                            <Text className={styles.name}>{d.name}</Text>
                          </Tooltip>
                          {threadCount(d.name) > 0 ? (
                            <span
                              className={styles.threads}
                              role="img"
                              aria-label={`${threadCount(d.name)} comment ${threadCount(d.name) === 1 ? 'thread' : 'threads'}`}
                            >
                              <ReviewIcon size={11} />
                              {threadCount(d.name)}
                            </span>
                          ) : null}
                          <Text variant="mono" tone="secondary">
                            {shotBadge(d)}
                          </Text>
                        </RouterLink>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </nav>
          {selected && selectedGroup ? (
            <Viewer
              diff={selected}
              kind={selectedGroup}
              review={shotDecision(selected, buildReview)}
              mode={mode}
              baselineNumber={baseline?.number}
              baselineBranch={baseline?.branch}
              commitSha={build.commitSha}
              onMode={(m) =>
                void navigate({ search: (prev) => ({ ...prev, mode: m }), replace: true })
              }
              onPrevious={hasPrevious ? () => goToShot(previous) : undefined}
              onNext={hasNext ? () => goToShot(next) : undefined}
              onHelp={() => setHelpOpen(true)}
              designEnabled={designEnabled}
              {...(ignore ? { ignore } : {})}
              issues={
                <SnapshotIssues
                  workspace={team.workspaceSlug}
                  team={team.slug}
                  number={build.number}
                  snapshotName={selected.name}
                />
              }
              regions={{
                threads: pinned.flatMap((c, i) =>
                  c.region
                    ? [
                        {
                          id: c.id,
                          number: i + 1,
                          region: c.region,
                          side: c.regionSide,
                          adjustable: c.mine,
                        },
                      ]
                    : [],
                ),
                focusedId: focusedComment,
                draft,
                draftKey,
                onDraw: (side, region) => {
                  addComment.reset()
                  setDraftKey((k) => k + 1)
                  setDraft({ shotId: selected.id, side, region })
                },
                onAdjustDraft: (region) => setDraft(draft && { ...draft, region }),
                onAdjust: (id, region) =>
                  setRegion
                    .mutateAsync({ id, region })
                    .then(() => announce('Region saved'))
                    .catch(() => undefined),
                error: setRegion.error?.message,
                onMarker: (id) => {
                  setTab('comments')
                  setFocusedComment(id)
                },
                composer: {
                  onSend: (body) => {
                    if (!draft) return
                    addComment.mutate(
                      {
                        body,
                        snapshotName: selected.name,
                        region: draft.region,
                        regionSide: apiSide(draft.side),
                      },
                      {
                        onSuccess: () => {
                          setDraft(null)
                          announce('Comment added.')
                        },
                      },
                    )
                  },
                  onCancel: () => {
                    addComment.reset()
                    setDraft(null)
                  },
                  author: session?.user
                    ? { ...session.user, image: session.user.image ?? null }
                    : undefined,
                  members,
                  sending: addComment.isPending,
                  error: addComment.error?.message,
                },
              }}
            />
          ) : null}
          <PaneHandle pane="build-rail" cssVar="--circi-rail-width" at="var(--circi-rail-width)" />
          <PaneHandle
            pane="build-discussion"
            edge="start"
            cssVar="--circi-side-width"
            at="calc(100% - var(--circi-side-width))"
          />
          <ReviewSidebar
            data={data}
            tab={tab}
            onTab={setTab}
            snapshotName={selected?.name ?? null}
            focusedId={focusedComment}
            composerRef={composer}
            onOpenComment={(id) => {
              setTab('comments')
              setFocusedComment(id)
            }}
            onShowSnapshot={(name, id) => {
              void navigate({ search: (prev) => ({ ...prev, shot: name }), replace: true })
              setFocusedComment(id)
            }}
            onRequestReview={() => setRequesting(true)}
          />
        </div>
      )}
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} designEnabled={designEnabled} />
    </div>
  )
}

export namespace BuildReview {
  export interface Props {
    data: Build.Detail
    /** Offers the Design compare mode (key 5); false until the Figma integration lands (Phase D). */
    designEnabled?: boolean
  }
}

/** Where the comparison comes from: plain metadata normally, a banner when it's an orphan or a fallback. */
function BaselineNote({ data }: BaselineNote.Props) {
  const { build, baseline } = data
  if (isActive(build.status) || build.status === 'expired') return null
  if (!baseline) {
    return (
      <Banner tone="info">
        This is the first build, so every screenshot is new. Later builds are compared with it once
        it's approved.
      </Banner>
    )
  }
  const where = (
    <>
      build #{baseline.number} on {baseline.branch ?? 'an unknown branch'} (
      <Text variant="mono" title={baseline.commitSha}>
        {baseline.commitSha.slice(0, 7)}
      </Text>
      )
    </>
  )
  if (build.baselineSource === 'fallback') {
    return (
      <Banner tone="warning">
        Compared with {where}, the latest on the default branch, because this build's git history
        wasn't available. Changes merged since this branch was created may show up here. Fetch more
        history in CI (for example <code>fetch-depth: 0</code>) for an exact comparison.
      </Banner>
    )
  }
  return (
    <Text variant="small" tone="secondary" as="p">
      Compared with {where}, where this branch started.
    </Text>
  )
}

export namespace BaselineNote {
  export interface Props {
    data: Build.Detail
  }
}
