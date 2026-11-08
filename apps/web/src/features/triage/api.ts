import type { Build, Comment, Triage, TriageKind } from '@circi/api'
import type { Status } from '@circi/ui'
import {
  queryOptions,
  useMutation,
  useQueries,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'

import { getJson, post, seg } from '../../lib/http.ts'
import type { SnoozeChoice } from '../../lib/snooze.ts'
import { fileUrl } from '../builds/api.ts'
import {
  type ShotKind,
  screenshotLabel,
  screenshotStatus,
  shotReview,
} from '../builds/diff-status.ts'

export const triageKey = (org: string, project: string) => ['triage', org, project] as const

export const triageQuery = (org: string, project: string) =>
  queryOptions({
    queryKey: triageKey(org, project),
    queryFn: () => getJson<Triage.Queue>(`/api/projects/${seg(org)}/${seg(project)}/triage`),
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

// -- Ignore regions ------------------------------------------------------------------------------

/**
 * A region drawn as fractions of the image, as the whole-number pixel rectangle the server stores
 * (it rejects anything else); undefined when the image's size is unknown or the box rounds away.
 */
export function regionToPixels(
  region: Comment.Region,
  size: { width: number | null; height: number | null },
): { x: number; y: number; width: number; height: number } | undefined {
  if (!size.width || !size.height) return undefined
  const x = Math.round(region.x * size.width)
  const y = Math.round(region.y * size.height)
  const width = Math.max(1, Math.round(region.width * size.width))
  const height = Math.max(1, Math.round(region.height * size.height))
  return { x, y, width, height }
}

// -- The filmstrip -------------------------------------------------------------------------------

export const FILMSTRIP_LENGTH = 5

/** The build numbers of the filmstrip: the item's build and the ones before it, newest first. */
export function filmstripNumbers(number: number, length = FILMSTRIP_LENGTH): number[] {
  return Array.from({ length }, (_, i) => number - i).filter((n) => n >= 1)
}

export interface Frame {
  number: number
  status: Status
  label: string
  /** The image of the snapshot in that build; null when the build has no such snapshot. */
  src: string | null
  sha256: string | null
  width: number | null
  height: number | null
}

/**
 * One frame of the filmstrip: the snapshot `name` in a build. A screenshot that changes in a
 * flaky item shows the flaky glyph; the rest follow `screenshotStatus`.
 */
export interface FrameSource {
  build: Pick<Build.ListItem, 'number' | 'status' | 'reviewStatus'>
  diffs: readonly Pick<Build.DiffItem, 'name' | 'status' | 'head' | 'base'>[]
}

export function frameOf(detail: FrameSource, name: string, itemKind: TriageKind): Frame {
  const diff = detail.diffs.find((d) => d.name === name)
  const number = detail.build.number
  if (!diff) {
    return {
      number,
      status: 'neutral',
      label: 'Not in this build',
      src: null,
      sha256: null,
      width: null,
      height: null,
    }
  }
  const kind: ShotKind =
    itemKind === 'flaky' && diff.status === 'changed' ? 'flaky' : (diff.status ?? 'unchanged')
  const review = shotReview(detail.build)
  const image = diff.head ?? diff.base
  return {
    number,
    status: screenshotStatus(kind, review),
    label: screenshotLabel(kind, review),
    src: image ? fileUrl(image.thumbnail ?? image.sha256) : null,
    sha256: image?.sha256 ?? null,
    width: image?.width ?? null,
    height: image?.height ?? null,
  }
}

const buildDetailQuery = (org: string, project: string, number: number) =>
  queryOptions({
    queryKey: ['build', org, project, number],
    queryFn: () =>
      getJson<Build.Detail>(`/api/projects/${seg(org)}/${seg(project)}/builds/${number}`),
    retry: false,
  })

/** The recent builds' frames of a snapshot, newest first; builds that can't be read are left out. */
export function useFilmstrip(org: string, project: string, item: Triage.Item | undefined) {
  const name = item?.snapshotName ?? undefined
  const numbers = item && name ? filmstripNumbers(item.build.number) : []
  const results = useQueries({
    queries: numbers.map((n) => buildDetailQuery(org, project, n)),
  })
  const kind = item?.kind
  const frames =
    name && kind ? results.flatMap((r) => (r.data ? [frameOf(r.data, name, kind)] : [])) : []
  return { frames, loading: results.some((r) => r.isPending) }
}

// -- Mutations -----------------------------------------------------------------------------------

async function refresh(queryClient: QueryClient, org: string, project: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: triageKey(org, project) }),
    queryClient.invalidateQueries({ queryKey: ['sidebar'] }),
  ])
}

/**
 * A change to one item, applied to the cached queue at once and put back if the server says no.
 * `apply` is how the queue looks after the change.
 */
function useOptimistic<V extends { ref: Ref }>(
  org: string,
  project: string,
  apply: (queue: Triage.Queue, vars: V) => Triage.Queue,
  mutationFn: (vars: V) => Promise<unknown>,
) {
  const queryClient = useQueryClient()
  const key = triageKey(org, project)
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
    onSettled: () => refresh(queryClient, org, project),
  })
}

const base = (org: string, project: string) => `/api/projects/${seg(org)}/${seg(project)}`

export function useAssignTriage(org: string, project: string) {
  return useOptimistic(
    org,
    project,
    (queue, v: { ref: Ref; assignee: Triage.Item['assignee'] }) =>
      withAssignee(queue, v.ref, v.assignee),
    (v) =>
      post<Triage.ItemState>(`${base(org, project)}/triage/assign`, {
        ...refOf(v.ref),
        assigneeId: v.assignee?.id ?? null,
      }),
  )
}

export function useSnoozeTriage(org: string, project: string) {
  return useOptimistic(
    org,
    project,
    (queue, v: { ref: Ref; choice: SnoozeChoice }) => withoutItem(queue, v.ref),
    (v) =>
      post<Triage.ItemState>(
        `${base(org, project)}/triage/snooze`,
        snoozeBody(refOf(v.ref), v.choice),
      ),
  )
}

export function useDismissTriage(org: string, project: string) {
  return useOptimistic(
    org,
    project,
    (queue, v: { ref: Ref }) => withoutItem(queue, v.ref),
    (v) => post<Triage.ItemState>(`${base(org, project)}/triage/dismiss`, refOf(v.ref)),
  )
}

/**
 * Accept as baseline: the existing build review, approved. There is no per-snapshot approval, so
 * this approves the item's whole build (the item leaves the queue once the server recomputes it).
 */
export function useAcceptBaseline(org: string, project: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (v: { ref: Ref; buildNumber: number }) =>
      post<{ build: { reviewStatus: string } }>(
        `${base(org, project)}/builds/${v.buildNumber}/review`,
        { state: 'approved' },
      ),
    onSuccess: async (_data, v) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['build', org, project, v.buildNumber] }),
        queryClient.invalidateQueries({ queryKey: ['project', org, project] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        refresh(queryClient, org, project),
      ])
    },
  })
}

export interface NewRegion {
  ref: Ref
  name: string
  rect: { x: number; y: number; width: number; height: number }
}

/** Add an ignore region on a snapshot; `resolves` has the server dismiss the item with it. */
export function useAddIgnoreRegion(org: string, project: string) {
  return useOptimistic(
    org,
    project,
    (queue, v: NewRegion) => withoutItem(queue, v.ref),
    (v) =>
      post(`${base(org, project)}/ignore-regions`, {
        name: v.name,
        ...v.rect,
        resolves: refOf(v.ref),
      }),
  )
}
