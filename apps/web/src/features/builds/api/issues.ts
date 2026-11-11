import type { Build, Issue } from '@circi/api'
import { defaultIssueTitle, issueDescription } from '@circi/core'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { projectPath } from '#lib/api-paths.ts'
import { getJson, post } from '#lib/http.ts'
import { invalidateAll, keys } from '#lib/query-keys.ts'

import { fileUrl } from './index.ts'

const base = (workspace: string, project: string, number: number) =>
  projectPath(workspace, project, 'builds', number, 'issues')

/** The issues created from a build and the trackers its project files issues in (none: no "Create issue"). */
export const issuesQuery = (workspace: string, project: string, number: number) =>
  queryOptions({
    queryKey: keys.issues(workspace, project, number),
    queryFn: () => getJson<Issue.List>(base(workspace, project, number)),
  })

/** Creates an issue; the build page, its issues and its activity refresh afterwards. */
export function useCreateIssue(workspace: string, project: string, number: number) {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { what: 'create the issue' },
    mutationFn: (input: Issue.Create) => post<Issue.Ref>(base(workspace, project, number), input),
    onSuccess: () =>
      invalidateAll(
        queryClient,
        keys.issues(workspace, project, number),
        keys.build(workspace, project, number),
        keys.activity(workspace, project, number),
      ),
  })
}

/**
 * The title and description the server will use, for the dialog's preview: the same text, from
 * the same function, as the service builds (`@circi/core`). `origin` is where the dashboard is
 * served (the server uses its configured public address, which is the same place).
 */
export function issuePreview(
  data: Pick<Build.Detail, 'project' | 'build' | 'reviews' | 'diffs'>,
  snapshotName: string | null,
  origin: string,
): { title: string; description: string } {
  const { build, project } = data
  const shot = snapshotName ? data.diffs.find((d) => d.name === snapshotName) : undefined
  const sha = shot?.diff?.sha256 ?? shot?.head?.sha256 ?? null
  const buildUrl = `${origin}/${project.workspaceSlug}/${project.slug}/builds/${build.number}`
  const rejection = data.reviews.find((r) => r.state === 'rejected')
  return {
    title: defaultIssueTitle(snapshotName, build.number),
    description: issueDescription({
      number: build.number,
      project: `${project.workspaceSlug}/${project.slug}`,
      branch: build.branch,
      prNumber: build.prNumber,
      commitSha: build.commitSha,
      author: build.author?.login ?? null,
      buildUrl: snapshotName ? `${buildUrl}?shot=${encodeURIComponent(snapshotName)}` : buildUrl,
      snapshotName,
      rejection: rejection ? { by: rejection.userName, reason: rejection.reason } : null,
      imageUrl: sha ? `${origin}${fileUrl(sha)}` : null,
    }),
  }
}
