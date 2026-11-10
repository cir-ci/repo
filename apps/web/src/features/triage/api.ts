import type { Snapshot, Triage, TriageKind } from '@circi/api'
import type { Status } from '@circi/ui'
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'

import { fileUrl } from '#features/builds/api/index.ts'
import {
  type ShotKind,
  screenshotLabel,
  screenshotStatus,
  shotReview,
} from '#features/builds/diff-status.ts'
import { teamPath } from '#lib/api-paths.ts'
import { getJson, post } from '#lib/http.ts'
import { invalidateAll, keys } from '#lib/query-keys.ts'
import type { SnoozeChoice } from '#lib/snooze.ts'

export const triageQuery = (workspace: string, team: string) =>
  queryOptions({
    queryKey: keys.triage(workspace, team),
    queryFn: () => getJson<Triage.Queue>(teamPath(workspace, team, 'triage')),
  })

export const KIND_LABEL: Record<TriageKind, string> = {
  flaky: 'Flaky',
  no_baseline: 'No baseline',
  failed: 'Failed',
}

const KIND_ORDER: readonly TriageKind[] = ['flaky', 'no_baseline', 'failed']

/** The identity of an item in the queue, as a DOM id and a selection key. */
export const itemId = (item: Pick<Triage.Item, 'kind' | 'key'>) => `${item.kind}:${item.key}`

export interface TriageGroup {
  kind: TriageKind
  label: string
  items: Triage.Item[]
}

/**
 * The queue's groups in display order (Flaky, No baseline, Failed), empty groups left out.
 * Snoozed items are set aside: they come back when the snooze ends.
 */
export function groupItems(items: readonly Triage.Item[]): TriageGroup[] {
  return KIND_ORDER.map((kind) => ({
    kind,
    label: KIND_LABEL[kind],
    items: items.filter((i) => i.kind === kind && !i.snoozed),
  })).filter((g) => g.items.length > 0)
}

/** The queue as one list in on-screen order, for J / K. */
export const flatten = (groups: readonly TriageGroup[]): Triage.Item[] =>
  groups.flatMap((g) => g.items)

/** "12 items to triage", "Nothing to triage": what the page announces as its count. */
export function queueCount(groups: readonly TriageGroup[]): string {
  const total = groups.reduce((n, g) => n + g.items.length, 0)
  return total === 0 ? 'Nothing to triage' : `${total} ${total === 1 ? 'item' : 'items'} to triage`
}

/** A row's name for assistive tech: kind, snapshot (or build), build and branch. */
export function itemName(item: Triage.Item): string {
  const what = item.snapshotName ?? `Build #${item.build.number}`
  const where = item.snapshotName ? `build #${item.build.number}` : undefined
  return [KIND_LABEL[item.kind], what, where, item.build.branch].filter(Boolean).join(', ')
}

/** The row's title: the snapshot's name, or the failed build. */
export const itemTitle = (item: Triage.Item): string =>
  item.snapshotName ?? `Build #${item.build.number} failed`

const SPANS: [string, number][] = [
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

/** "Waiting 3 days", "Waiting under a minute": how long the problem has waited as of `now`. */
export function sinceText(iso: string, now: number): string {
  const seconds = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  const span = SPANS.find(([, s]) => seconds >= s)
  if (!span) return 'Waiting under a minute'
  const n = Math.floor(seconds / span[1])
  return `Waiting ${n} ${span[0]}${n === 1 ? '' : 's'}`
}

/** "On triage this week: Ada", or undefined without a rotation. */
export const rotationText = (rotation: Triage.Queue['rotation']): string | undefined =>
  rotation.onTriage ? `On triage: ${rotation.onTriage.name}` : undefined

// -- Optimistic changes to the cached queue ------------------------------------------------------

type Ref = Pick<Triage.Item, 'kind' | 'key'>
/** Just the identity of an item: callers hold whole items, the server wants `kind` and `key`. */
export const refOf = (item: Ref): Ref => ({ kind: item.kind, key: item.key })
const same = (a: Ref, b: Ref) => a.kind === b.kind && a.key === b.key

export function withoutItem(queue: Triage.Queue, ref: Ref): Triage.Queue {
  return { ...queue, items: queue.items.filter((i) => !same(i, ref)) }
}

export function withAssignee(
  queue: Triage.Queue,
  ref: Ref,
  assignee: Triage.Item['assignee'],
): Triage.Queue {
  return { ...queue, items: queue.items.map((i) => (same(i, ref) ? { ...i, assignee } : i)) }
}

/** What the server is sent for a snooze: the menu's choice as the route's body. */
export function snoozeBody(
  ref: Ref,
  choice: SnoozeChoice,
): Ref & ({ choice: 'next_push' | 'tomorrow' | 'next_week' } | { choice: 'date'; date: string }) {
  return choice.kind === 'date'
    ? { ...ref, choice: 'date', date: choice.date }
    : { ...ref, choice: choice.kind }
}

// -- The filmstrip -------------------------------------------------------------------------------

export const FILMSTRIP_LENGTH = 5

export interface Frame {
  number: number
  status: Status
  label: string
  /** The image of the snapshot in that build; null when the build has none. */
  src: string | null
  sha256: string | null
  width: number | null
  height: number | null
}

/**
 * One frame of the filmstrip: the snapshot in one build of its history. A screenshot that
 * changes in a flaky item shows the flaky glyph; the rest follow `screenshotStatus`.
 */
export function frameOf(entry: Snapshot.HistoryEntry, itemKind: TriageKind): Frame {
  const kind: ShotKind =
    itemKind === 'flaky' && entry.status === 'changed' ? 'flaky' : (entry.status ?? 'unchanged')
  const review = shotReview(entry.build)
  const image = entry.image
  return {
    number: entry.build.number,
    status: screenshotStatus(kind, review),
    label: screenshotLabel(kind, review),
    src: image ? fileUrl(image.thumbnail ?? image.sha256) : null,
    sha256: image?.sha256 ?? null,
    width: image?.width ?? null,
    height: image?.height ?? null,
  }
}

/**
 * A snapshot's recent builds on the default branch, newest first. `build` anchors the list on the
 * triage item's own build, so its frame is always there; without it the list starts at the newest.
 */
export const snapshotHistoryQuery = (
  workspace: string,
  team: string,
  name: string,
  build?: number,
  limit: number = FILMSTRIP_LENGTH,
) =>
  queryOptions({
    queryKey: keys.snapshotHistory(workspace, team, name, build ?? `last-${limit}`),
    queryFn: () =>
      getJson<Snapshot.History>(
        `${teamPath(workspace, team, 'snapshots', name, 'history')}?limit=${limit}${build ? `&build=${build}` : ''}`,
      ),
  })

/** The recent builds' frames of a snapshot, newest first: one request, whatever the length. */
export function useFilmstrip(workspace: string, team: string, item: Triage.Item | undefined) {
  const name = item?.snapshotName ?? undefined
  const history = useQuery({
    ...snapshotHistoryQuery(workspace, team, name ?? '', item?.build.number ?? 0),
    enabled: name !== undefined,
  })
  const kind = item?.kind
  const frames =
    kind && history.data && name !== undefined
      ? history.data.default.map((entry) => frameOf(entry, kind))
      : []
  return { frames, loading: name !== undefined && history.isPending }
}

// -- Mutations -----------------------------------------------------------------------------------

async function refresh(queryClient: QueryClient, workspace: string, team: string) {
  await invalidateAll(queryClient, keys.triage(workspace, team), keys.sidebar())
}

/**
 * A change to one item, applied to the cached queue at once and put back if the server says no.
 * `apply` is how the queue looks after the change.
 */
function useOptimistic<V extends { ref: Ref }>(
  workspace: string,
  team: string,
  apply: (queue: Triage.Queue, vars: V) => Triage.Queue,
  mutationFn: (vars: V) => Promise<unknown>,
) {
  const queryClient = useQueryClient()
  const key = keys.triage(workspace, team)
  return useMutation({
    mutationFn,
    onMutate: async (vars: V) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<Triage.Queue>(key)
      if (previous) queryClient.setQueryData(key, apply(previous, vars))
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },
    onSettled: () => refresh(queryClient, workspace, team),
  })
}

export function useAssignTriage(workspace: string, team: string) {
  return useOptimistic(
    workspace,
    team,
    (queue, v: { ref: Ref; assignee: Triage.Item['assignee'] }) =>
      withAssignee(queue, v.ref, v.assignee),
    (v) =>
      post<Triage.ItemState>(teamPath(workspace, team, 'triage', 'assign'), {
        ...refOf(v.ref),
        assigneeId: v.assignee?.id ?? null,
      }),
  )
}

export function useSnoozeTriage(workspace: string, team: string) {
  return useOptimistic(
    workspace,
    team,
    (queue, v: { ref: Ref; choice: SnoozeChoice }) => withoutItem(queue, v.ref),
    (v) =>
      post<Triage.ItemState>(
        teamPath(workspace, team, 'triage', 'snooze'),
        snoozeBody(refOf(v.ref), v.choice),
      ),
  )
}

export function useDismissTriage(workspace: string, team: string) {
  return useOptimistic(
    workspace,
    team,
    (queue, v: { ref: Ref }) => withoutItem(queue, v.ref),
    (v) => post<Triage.ItemState>(teamPath(workspace, team, 'triage', 'dismiss'), refOf(v.ref)),
  )
}
