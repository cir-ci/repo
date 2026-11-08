import type { Build } from '@circi/api'
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

import { RouterLink } from '../../lib/router-link.ts'
import { useShortcutHandlers } from '../../lib/shortcuts.ts'
import { flakyQuery, isActive } from './api.ts'
import { BuildBreadcrumbs } from './BuildBreadcrumbs.tsx'
import { BuildMeta } from './BuildMeta.tsx'
import { BuildStateLabel } from './BuildStateLabel.tsx'
import { CountsSummary } from './CountsSummary.tsx'
import { screenshotLabel, screenshotStatus, shotReview } from './diff-status.ts'
import { Viewer } from './DiffViewer.tsx'
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
import { ROUTE, type ViewMode } from './search.ts'
import { ShortcutsDialog } from './ShortcutsDialog.tsx'

import page from './BuildPage.module.css'
import styles from './BuildReview.module.css'

/**
 * The build review screen (docs/design-gaps.md §7, provisional): the header with the decision,
 * a strip of context, then the screenshot list (280px, its own scroll) beside the viewer.
 */
export function BuildReview({ data }: BuildReview.Props) {
  const { build, baseline, project } = data
  const params = useParams({ from: ROUTE })
  const search = useSearch({ from: ROUTE })
  const navigate = useNavigate({ from: ROUTE })
  const mode: ViewMode = search.mode ?? 'side'
  const active = isActive(build.status)
  const review = useReviewControls(data)
  const [helpOpen, setHelpOpen] = useState(false)

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

  useShortcutHandlers({
    next: () => goToShot(neighbour(ordered, selected, 1)),
    previous: () => goToShot(neighbour(ordered, selected, -1)),
    mode: (action) =>
      void navigate({ search: (prev) => ({ ...prev, mode: action.mode }), replace: true }),
    approve: (_, e) => (e.repeat ? undefined : review.approve()),
    reject: (_, e) => (e.repeat ? undefined : review.askReject()),
    help: () => setHelpOpen(true),
  })

  // Keep the selected row in view in the list's own scroll when j / k (or the buttons) move on.
  const listRef = useRef<HTMLElement>(null)
  const scrolledFor = useRef(selected?.id)
  useEffect(() => {
    if (scrolledFor.current === selected?.id) return
    scrolledFor.current = selected?.id
    listRef.current?.querySelector('[data-selected]')?.scrollIntoView({ block: 'nearest' })
  }, [selected?.id])

  const hasBaseline = baseline !== null
  const buildReview = shotReview(build)
  return (
    <div className={page['page']}>
      <PanelHeader
        actions={
          <>
            <BuildStateLabel build={build} hasBaseline={hasBaseline} />
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
                <ul className={styles['rows']}>
                  {g.items.map((d) => (
                    <li key={d.id}>
                      <RouterLink
                        to={ROUTE}
                        params={params}
                        search={(prev) => ({ ...prev, shot: d.name })}
                        // Current only when chosen in the URL; the default one gets the same
                        // marker through `data-default`.
                        aria-current={d.id === fromUrl?.id ? 'page' : undefined}
                        data-default={!fromUrl && d.id === selected?.id ? '' : undefined}
                        data-selected={d.id === selected?.id ? '' : undefined}
                        className={styles['row']}
                      >
                        <StatusIcon
                          status={screenshotStatus(g.kind, buildReview)}
                          size={12}
                          label={screenshotLabel(g.kind, buildReview)}
                        />
                        <Tooltip content={d.name}>
                          <Text className={styles['name']}>{d.name}</Text>
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
            />
          ) : null}
        </div>
      )}
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  )
}

export namespace BuildReview {
  export interface Props {
    data: Build.Detail
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
