import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

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
  /** Approve/reject decisions, newest first. */
  reviews: ReviewEntry[]
  diffs: DiffItem[]
}

export type ReviewState = 'approved' | 'rejected'

export interface ReviewEntry {
  state: ReviewState
  source: 'ui' | 'github-check' | 'github-comment' | 'auto' | 'rerun'
  /** Null for automatic approvals. */
  userName: string | null
  createdAt: string
}

export class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  })
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
  // No-content answers (deletes) carry nothing to parse; callers of those ask for `undefined`.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  if (res.status === 204) return undefined as T
  // The server's tests pin these shapes.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (await res.json()) as T
}

export const getJson = <T>(path: string) => request<T>(path)

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

/**
 * Approve or reject a build's changes. Afterwards everything that shows the build's state is
 * refetched: its page, the project's builds list and the projects overview.
 */
export function useReviewBuild(org: string, project: string, number: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (state: ReviewState) =>
      request<{ build: { reviewStatus: ReviewState } }>(
        `/api/projects/${seg(org)}/${seg(project)}/builds/${number}/review`,
        { method: 'POST', body: JSON.stringify({ state }) },
      ),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['build', org, project, number] }),
        queryClient.invalidateQueries({ queryKey: ['project', org, project] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
      ]),
  })
}

export interface ProjectSettings {
  name: string
  defaultBranch: string
  diffThreshold: number
  autoApproveDefaultBranch: boolean
  blockMergeOnChanges: boolean
  retentionDays: number
}

export interface WebhookInfo {
  id: string
  url: string
  events: string[]
  enabled: boolean
  createdAt: string
}

export interface SettingsResponse {
  canManage: boolean
  settings: ProjectSettings
  webhooks: WebhookInfo[]
  webhookEvents: string[]
  github: {
    configured: boolean
    webhookUrl: string
    link: { installationId: string; repoRef: string } | null
  }
}

export const settingsQuery = (org: string, project: string) =>
  queryOptions({
    queryKey: ['settings', org, project],
    queryFn: () => getJson<SettingsResponse>(`/api/projects/${seg(org)}/${seg(project)}/settings`),
  })

/** Saves some project settings, then refreshes everything that shows them. */
export function useSaveSettings(org: string, project: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<ProjectSettings>) =>
      request<{ settings: ProjectSettings }>(`/api/projects/${seg(org)}/${seg(project)}/settings`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings', org, project] }),
        queryClient.invalidateQueries({ queryKey: ['project', org, project] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
      ]),
  })
}

export function useAddWebhook(org: string, project: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { url: string; events: string[] }) =>
      request<{ webhook: WebhookInfo; secret: string }>(
        `/api/projects/${seg(org)}/${seg(project)}/webhooks`,
        { method: 'POST', body: JSON.stringify(input) },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings', org, project] }),
  })
}

export function useDeleteWebhook(org: string, project: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      request<undefined>(`/api/projects/${seg(org)}/${seg(project)}/webhooks/${seg(id)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings', org, project] }),
  })
}

export interface Capabilities {
  canCreateOrganization: boolean
  manageableOrganizations: { slug: string; name: string }[]
  /** Organizations that won't show their content to the way this session signed in. */
  refusingOrganizations: { name: string; accepts: ('password' | 'email')[] }[]
}

export const capabilitiesQuery = () =>
  queryOptions({
    queryKey: ['capabilities'],
    queryFn: () => getJson<Capabilities>('/api/capabilities'),
  })

export const setupQuery = () =>
  queryOptions({
    queryKey: ['setup'],
    queryFn: () => getJson<{ needed: boolean }>('/api/setup'),
    staleTime: 0,
  })

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) })

export function useCreateOrganization() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) =>
      post<{ organization: { slug: string; name: string } }>('/api/organizations', { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['capabilities'] }),
  })
}

/** Creates a project; the response holds its CI token, which is shown only once. */
export function useCreateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { org: string; name: string }) =>
      post<{ project: { slug: string; name: string }; token: string }>(
        `/api/organizations/${seg(input.org)}/projects`,
        { name: input.name },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  })
}

export function useRotateToken(org: string, project: string) {
  return useMutation({
    mutationFn: () =>
      post<{ token: string }>(`/api/projects/${seg(org)}/${seg(project)}/token`, {}),
  })
}

export const submitSetup = (input: {
  code: string
  name: string
  email: string
  password: string
  organizationName: string
}) => post<{ email: string }>('/api/setup', input)

export interface OrgAuthResponse {
  canManage: boolean
  settings: { emailLoginEnabled: boolean; passwordLoginEnabled: boolean }
  instance: { password: boolean; email: boolean }
}

export const orgAuthQuery = (org: string) =>
  queryOptions({
    queryKey: ['org-auth', org],
    queryFn: () => getJson<OrgAuthResponse>(`/api/organizations/${seg(org)}/auth`),
  })

export function useSaveOrgAuth(org: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<OrgAuthResponse['settings']>) =>
      request<{ settings: OrgAuthResponse['settings'] }>(`/api/organizations/${seg(org)}/auth`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['org-auth', org] }),
  })
}

export interface OrgDomainInfo {
  id: string
  domain: string
  verified: boolean
  dnsName?: string
  dnsValue?: string
}

export const domainsQuery = (org: string) =>
  queryOptions({
    queryKey: ['org-domains', org],
    queryFn: () => getJson<{ domains: OrgDomainInfo[] }>(`/api/organizations/${seg(org)}/domains`),
  })

export function useDomainActions(org: string) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['org-domains', org] })
  const base = `/api/organizations/${seg(org)}/domains`
  return {
    add: useMutation({
      mutationFn: (domain: string) => post<{ domain: OrgDomainInfo }>(base, { domain }),
      onSuccess: refresh,
    }),
    verify: useMutation({
      mutationFn: (id: string) => post<{ verified: boolean }>(`${base}/${seg(id)}/verify`, {}),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => request<undefined>(`${base}/${seg(id)}`, { method: 'DELETE' }),
      onSuccess: refresh,
    }),
  }
}

export function useGithubLink(org: string, project: string) {
  const queryClient = useQueryClient()
  const url = `/api/projects/${seg(org)}/${seg(project)}/github`
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['settings', org, project] })
  return {
    save: useMutation({
      mutationFn: (input: { installationId: string; repoRef: string }) =>
        request<{ link: unknown }>(url, { method: 'PUT', body: JSON.stringify(input) }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: () => request<undefined>(url, { method: 'DELETE' }),
      onSuccess: refresh,
    }),
  }
}
