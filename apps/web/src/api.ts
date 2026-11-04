import { queryOptions } from '@tanstack/react-query'

/** Types, fetchers and TanStack Query options for the dashboard API (apps/server/src/dashboard.ts). */

export interface Counts {
  added: number
  removed: number
  changed: number
  unchanged: number
  failed: number
  total: number
}

export interface BuildListItem {
  id: string
  number: number
  name: string
  commitSha: string
  branch: string | null
  prNumber: number | null
  status: string
  conclusion: string | null
  reviewStatus: string
  createdAt: string
  counts: Counts
}

export interface ProjectOverview {
  org: { slug: string; name: string }
  project: { slug: string; name: string; defaultBranch: string }
  latestBuild: BuildListItem | null
}

export interface ProjectInfo {
  id: string
  slug: string
  name: string
  defaultBranch: string
  orgSlug: string
  orgName: string
}

export interface ImageRef {
  sha256: string
  width: number | null
  height: number | null
}

export type DiffStatus = 'added' | 'removed' | 'changed' | 'unchanged' | 'failed'

export interface DiffItem {
  id: string
  name: string
  status: DiffStatus | null
  score: number | null
  changedPixels: number | null
  sizeChanged: boolean
  errorMessage: string | null
  head: (ImageRef & { thumbnail: string | null; metadata: Record<string, unknown> }) | null
  base: (ImageRef & { thumbnail: string | null }) | null
  diff: ImageRef | null
}

export interface BuildDetail {
  project: ProjectInfo
  build: BuildListItem & {
    baseBranch: string | null
    ancestryStatus: string
    baselineSource: string | null
    errorMessage: string | null
    completedAt: string | null
  }
  baseline: { number: number; commitSha: string; branch: string | null } | null
  diffs: DiffItem[]
}

export class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' } })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body: unknown = await res.json()
      if (
        typeof body === 'object' &&
        body !== null &&
        'error' in body &&
        typeof body.error === 'string'
      ) {
        message = body.error
      }
    } catch {
      // Non-JSON error body: keep the status line.
    }
    throw new HttpError(res.status, message)
  }
  // The server's tests pin these shapes.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (await res.json()) as T
}

const seg = encodeURIComponent

/** Builds still being uploaded or processed; their pages poll until they finish. */
export const isActive = (status: string) =>
  status === 'pending' || status === 'uploading' || status === 'processing'

export const projectsQuery = () =>
  queryOptions({
    queryKey: ['projects'],
    queryFn: () => getJson<{ projects: ProjectOverview[] }>('/api/projects'),
  })

export const projectQuery = (org: string, project: string, before?: number) =>
  queryOptions({
    queryKey: ['project', org, project, before ?? null],
    queryFn: () =>
      getJson<{ project: ProjectInfo; builds: BuildListItem[] }>(
        `/api/projects/${seg(org)}/${seg(project)}${before ? `?before=${before}` : ''}`,
      ),
    refetchInterval: (q) => (q.state.data?.builds.some((b) => isActive(b.status)) ? 3_000 : false),
  })

/** Page size of the builds list (the server returns at most this many). */
export const BUILDS_PAGE_SIZE = 50

export const buildQuery = (org: string, project: string, number: number) =>
  queryOptions({
    queryKey: ['build', org, project, number],
    queryFn: () =>
      getJson<BuildDetail>(`/api/projects/${seg(org)}/${seg(project)}/builds/${number}`),
    refetchInterval: (q) => (q.state.data && isActive(q.state.data.build.status) ? 2_000 : false),
  })

export const fileUrl = (sha256: string) => `/api/files/${sha256}`
