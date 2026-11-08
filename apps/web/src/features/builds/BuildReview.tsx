import type { Build, Comment } from '@circi/api'
import {
  Banner,
  Collapsible,
  EmptyState,
  CollectionsIcon,
  PanelHeader,
  Ref,
  Stack,
  StatusIcon,
  Text,
  Tooltip,
  HourglassIcon,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'

import { ShortcutsDialog } from '#app/ShortcutsDialog.tsx'
import { RouterLink } from '#lib/router-link.ts'
import { isAvailable, SHORTCUTS, useShortcutHandlers } from '#lib/shortcuts.ts'
import { useListNavigation } from '#lib/use-list-navigation.ts'

import { flakyQuery, isActive } from './api.ts'
import { BuildBreadcrumbs } from './BuildBreadcrumbs.tsx'
import { BuildMeta } from './BuildMeta.tsx'
import { BuildStateLabel } from './BuildStateLabel.tsx'
import { CountsSummary } from './CountsSummary.tsx'
import { screenshotLabel, screenshotStatus, shotReview } from './diff-status.ts'
import { Viewer } from './DiffViewer.tsx'
import { commentsQuery } from './discussion-api.ts'
import { IssueAction } from './IssueAction.tsx'
import { regionThreads } from './regions.ts'
import { RequestReviewDialog } from './RequestReviewDialog.tsx'
import {
  defaultShot,
  GROUP_ORDER,
  groupShots,
  isReviewable,
  neighbour,
  orderShots,
  shotBadge,
} from './review-model.ts'
import { ReviewActions, ReviewNote, useReviewControls } from './ReviewActions.tsx'
import { ReviewSidebar, type SidebarTab } from './ReviewSidebar.tsx'
import { ROUTE, type ViewMode } from './search.ts'

import page from './BuildPage.module.css'
import styles from './BuildReview.module.css'

/**
 * The build review screen (docs/design-gaps.md §7, provisional): the header with the decision,
 * a strip of context, then the screenshot list (280px, its own scroll) beside the viewer.
 */
export function BuildReview({ data, designEnabled = false }: BuildReview.Props) {
  const { build, baseline, project } = data
  const params = useParams({ from: ROUTE })
  const search = useSearch({ from: ROUTE })
  const navigate = useNavigate({ from: ROUTE })
  const mode: ViewMode = search.mode ?? 'side'
  const active = isActive(build.status)
  const review = useReviewControls(data)
  const [helpOpen, setHelpOpen] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [tab, setTab] = useState<SidebarTab>('details')
  const [drawing, setDrawing] = useState(false)
  const [pendingRegion, setPendingRegion] = useState<Comment.Region | null>(null)
  const [focusedComment, setFocusedComment] = useState<string | null>(null)
  const composer = useRef<HTMLTextAreaElement>(null)

  // Flaky screenshots are set aside, but the page works without knowing them.
  const { data: flakyReport } = useQuery({
    ...flakyQuery(project.orgSlug, project.slug),
    enabled: !active,
  })
  const flaky = useMemo(() => new Set(flakyReport?.flaky.map((f) => f.name) ?? []), [flakyReport])
  const groups = useMemo(() => groupShots(data.diffs, flaky), [data.diffs, flaky])
  const ordered = useMemo(() => orderShots(groups), [groups])
  const fromUrl = search.shot ? ordered.find((d) => d.name === search.shot) : undefined
  const selected = fromUrl ?? defaultShot(groups)
  const selectedGroup = groups.find((g) => selected && g.items.includes(selected))?.kind

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
  })

  const comments = useQuery(commentsQuery(project.orgSlug, project.slug, build.number))
  const pinned = selected ? regionThreads(comments.data?.comments ?? [], selected.name) : []

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
  return (
    <div className={page['page']}>
      <PanelHeader
        actions={
          <>
            <BuildStateLabel build={build} hasBaseline={hasBaseline} />
            <IssueAction data={data} snapshotName={selected?.name ?? null} />
            {isReviewable(build) ? (
              <ReviewActions review={review} buildNumber={build.number} />
            ) : null}
          </>
        }
      >
        <BuildBreadcrumbs
          org={project.orgSlug}
          project={project.slug}
          number={build.number}
          name={build.name}
        />
        {build.branch ? <Ref value={build.branch} label="branch name" /> : null}
      </PanelHeader>

      <div className={page['context']}>
        <Stack direction="row" gap={3} wrap align="center">
          <BuildMeta build={build} showBranch={false} />
          {active ? null : <CountsSummary counts={build.counts} review={buildReview} />}
        </Stack>
        <ReviewNote data={data} />
        <BaselineNote data={data} />
        {review.error ? <Banner tone="danger">{review.error.message}</Banner> : null}
        {build.errorMessage ? <Banner tone="danger">{build.errorMessage}</Banner> : null}
        {active ? (
          <Banner tone="info">Processing screenshots. This page updates when it’s done.</Banner>
        ) : null}
      </div>

      {build.status === 'expired' ? (
        <EmptyState icon={<HourglassIcon size={32} />} title="This build has expired">
          Its screenshots were deleted under the project’s retention policy.
        </EmptyState>
      ) : ordered.length === 0 ? (
        active ? null : (
          <EmptyState icon={<CollectionsIcon size={32} />} title="No screenshots in this build">
            The upload contained no PNG files.
          </EmptyState>
        )
      ) : (
        <div className={page['body']}>
          <nav ref={listRef} aria-label="Screenshots" className={page['list']}>
            {groups.map((g) => (
              <Collapsible
                key={g.kind}
                title={g.title}
                count={g.items.length}
                open={open[g.kind] ?? g.open}
                onOpenChange={(expanded) => setOpen({ ...open, [g.kind]: expanded })}
              >
                <ul className={styles.rows}>
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
                          status={screenshotStatus(g.kind, buildReview)}
                          size={12}
                          label={screenshotLabel(g.kind, buildReview)}
                        />
                        <Tooltip content={d.name}>
                          <Text className={styles.name}>{d.name}</Text>
                        </Tooltip>
                        <Text variant="mono" tone="secondary">
                          {shotBadge(d)}
                        </Text>
                      </RouterLink>
                    </li>
                  ))}
                </ul>
              </Collapsible>
            ))}
          </nav>
          {selected && selectedGroup ? (
            <Viewer
              diff={selected}
              kind={selectedGroup}
              review={buildReview}
              mode={mode}
              baselineNumber={baseline?.number}
              onMode={(m) =>
                void navigate({ search: (prev) => ({ ...prev, mode: m }), replace: true })
              }
              onPrevious={hasPrevious ? () => goToShot(previous) : undefined}
              onNext={hasNext ? () => goToShot(next) : undefined}
              onHelp={() => setHelpOpen(true)}
              designEnabled={designEnabled}
              annotations={{
                threads: pinned.flatMap((c, i) =>
                  c.region ? [{ id: c.id, number: i + 1, region: c.region }] : [],
                ),
                pending: pendingRegion,
                focusedId: focusedComment,
                drawing,
                onDrawingChange: setDrawing,
                onDraw: (region) => {
                  setPendingRegion(region)
                  setDrawing(false)
                  openComposer()
                },
                onMarker: (id) => {
                  setTab('comments')
                  setFocusedComment(id)
                },
              }}
            />
          ) : null}
          <ReviewSidebar
            data={data}
            tab={tab}
            onTab={setTab}
            snapshotName={selected?.name ?? null}
            pendingRegion={pendingRegion}
            onClearRegion={() => setPendingRegion(null)}
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
      <RequestReviewDialog
        open={requesting}
        onClose={() => setRequesting(false)}
        org={project.orgSlug}
        project={project.slug}
        number={build.number}
      />
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
        First build to compare against: every screenshot is new. Later builds are compared with this
        one once it’s approved.
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
        Compared with {where}, the latest on the default branch, because this build’s git history
        wasn’t available. Changes merged since this branch was created may show up here. Fetch more
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
