import type { Snapshot, Triage, TriageKind } from '@circi/api'
import { flakyReasonText } from '@circi/core'
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'

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

/** "3 days", "under a minute": how long the problem has waited as of `now`. */
export function waitingFor(iso: string, now: number): string {
  const seconds = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  const span = SPANS.find(([, s]) => seconds >= s)
  if (!span) return 'under a minute'
  const n = Math.floor(seconds / span[1])
  return `${n} ${span[0]}${n === 1 ? '' : 's'}`
}

/** "Changed in 4 of the last 10 commits": what a flaky item's history says. */
export function changedText(history: Triage.Item['history']): string {
  const changed = history.filter((h) => h.changed).length
  return `Changed in ${changed} of the last ${history.length} commits`
}

/** The second line of a row: why the item is in the queue. */
export function itemSubtitle(item: Triage.Item): string {
  if (item.kind === 'flaky') {
    return item.reason ? flakyReasonText(item.reason) : changedText(item.history)
  }
  if (item.kind === 'no_baseline') return `First seen in build #${item.build.number}`
  return item.error ?? 'The build failed'
}

/** What the item holds up, for the pane's Blocking row. */
export function blockingText(item: Triage.Item): string {
  if (item.kind === 'failed') return 'The check on this commit is failing'
  if (item.blocking === 0) return 'Nothing'
  return item.blocking === 1
    ? '1 pull request shows it as changed'
    : `${item.blocking} pull requests show it as changed`
}

/** "On triage: Ada until Mon", or undefined without a rotation. */
export function rotationText(rotation: Triage.Queue['rotation']): string | undefined {
  if (!rotation.onTriage) return undefined
  const until = rotation.until
    ? ` until ${new Date(rotation.until).toLocaleDateString('en', { weekday: 'short' })}`
    : ''
  return `On triage: ${rotation.onTriage.name}${until}`
}

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

// -- The screenshot ------------------------------------------------------------------------------

/**
 * A snapshot's recent builds on the default branch, newest first. `build` anchors the list on the
 * triage item's own build, so its frame is always there; without it the list starts at the newest.
 */
export const snapshotHistoryQuery = (
  workspace: string,
  team: string,
  name: string,
  build?: number,
  limit: number = 5,
) =>
  queryOptions({
    queryKey: keys.snapshotHistory(workspace, team, name, build ?? `last-${limit}`),
    queryFn: () =>
      getJson<Snapshot.History>(
        `${teamPath(workspace, team, 'snapshots', name, 'history')}?limit=${limit}${build ? `&build=${build}` : ''}`,
      ),
  })

/** The item's screenshot in its own build, for the preview. */
export function useItemImage(workspace: string, team: string, item: Triage.Item | undefined) {
  const name = item?.snapshotName ?? undefined
  const history = useQuery({
    ...snapshotHistoryQuery(workspace, team, name ?? '', item?.build.number ?? 0),
    enabled: name !== undefined,
  })
  const image =
    history.data?.default.find((e) => e.build.number === item?.build.number)?.image ?? null
  return { image, loading: name !== undefined && history.isPending }
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

/** Compares a failed build again: it leaves the queue at once, and comes back if the server says no. */
export function useRerunTriage(workspace: string, team: string) {
  return useOptimistic(
    workspace,
    team,
    (queue, v: { ref: Ref; number: number }) => withoutItem(queue, v.ref),
    (v) => post<Triage.Rerun>(teamPath(workspace, team, 'triage', 'rerun'), { number: v.number }),
  )
}
