import type { Storage, Workspace } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { getJson, send, seg } from '#lib/http.ts'

// ---- Workspace General ------------------------------------------------------------------------

export const workspaceGeneralQuery = (workspace: string) =>
  queryOptions({
    queryKey: ['workspace-general', workspace],
    queryFn: () => getJson<Workspace.General>(`/api/workspaces/${seg(workspace)}`),
  })

/** Renames the workspace and/or changes its address (the old address stops working). */
export function useSaveWorkspaceGeneral(workspace: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: { name?: string; slug?: string }) =>
      send<{ name: string; slug: string }>('PATCH', `/api/workspaces/${seg(workspace)}`, patch),
    // The name and address show in the sidebar, the switcher and every page header.
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

/** Deletes the workspace (owners; `confirm` is its name typed back). It disappears for everyone at once. */
export function useDeleteWorkspace(workspace: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (confirm: string) =>
      send<Workspace.Deleted>('DELETE', `/api/workspaces/${seg(workspace)}`, { confirm }),
    // The workspace leaves the sidebar, the switcher and the capabilities at once.
    onSuccess: () =>
      Promise.all(
        [['teams'], ['sidebar'], ['capabilities']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  })
}

// ---- Storage ----------------------------------------------------------------------------------

export const storageQuery = (workspace: string) =>
  queryOptions({
    queryKey: ['workspace-storage', workspace],
    queryFn: () => getJson<Storage.Usage>(`/api/workspaces/${seg(workspace)}/storage`),
  })

export const KIND_LABEL: Record<Storage.Kind, string> = {
  screenshot: 'Screenshots',
  diff: 'Diff images',
  thumbnail: 'Thumbnails',
  site: 'Hosted sites',
}

const KIND_ORDER: readonly Storage.Kind[] = ['screenshot', 'diff', 'thumbnail', 'site']

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** "0 B", "1.5 MB", "230 KB": decimal units, one decimal below 10. */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000
    unit++
  }
  const text = unit === 0 || value >= 10 ? String(Math.round(value)) : value.toFixed(1)
  return `${text.replace(/\.0$/, '')} ${UNITS[unit]}`
}

/** "1 file", "41,260 files". */
export const fileCount = (files: number) =>
  `${files.toLocaleString('en-US')} ${files === 1 ? 'file' : 'files'}`

/** "1 day", "90 days". */
export const dayCount = (days: number) => `${days} ${days === 1 ? 'day' : 'days'}`

/** The kinds in the board's order (kinds with nothing stored included), each with its share of `totalBytes`. */
export function kindRows(storage: Pick<Storage.Usage, 'kinds' | 'totalBytes'>) {
  return KIND_ORDER.map((kind) => {
    const found = storage.kinds.find((k) => k.kind === kind)
    const bytes = found?.bytes ?? 0
    return {
      kind,
      label: KIND_LABEL[kind],
      files: found?.files ?? 0,
      versions: found?.versions,
      bytes,
      share: storage.totalBytes > 0 ? Math.min(1, bytes / storage.totalBytes) : 0,
    }
  })
}

/** The teams by size, biggest first, each with its share of the biggest (so the largest bar is full). */
export function teamRows(storage: Pick<Storage.Usage, 'teams'>) {
  const sorted = storage.teams.toSorted((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
  const biggest = sorted[0]?.bytes ?? 0
  return sorted.map((t) => Object.assign({}, t, { share: biggest > 0 ? t.bytes / biggest : 0 }))
}
