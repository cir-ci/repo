import type { Build, Issue } from '@circi/api'
import { defaultIssueTitle, issueDescription } from '@circi/core/issues'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { getJson, post, seg } from '#lib/http.ts'

import { fileUrl } from './api.ts'

const base = (org: string, project: string, number: number) =>
  `/api/projects/${seg(org)}/${seg(project)}/builds/${number}/issues`

/** The issues created from a build and the trackers its project files issues in (none: no "Create issue"). */
export const issuesQuery = (org: string, project: string, number: number) =>
  queryOptions({
    queryKey: ['issues', org, project, number],
    queryFn: () => getJson<Issue.List>(base(org, project, number)),
  })

/** Creates an issue; the build page, its issues and its activity refresh afterwards. */
export function useCreateIssue(org: string, project: string, number: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Issue.Create) => post<Issue.Ref>(base(org, project, number), input),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['issues', org, project, number] }),
        queryClient.invalidateQueries({ queryKey: ['build', org, project, number] }),
        queryClient.invalidateQueries({ queryKey: ['activity', org, project, number] }),
      ]),
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
  const buildUrl = `${origin}/${project.orgSlug}/${project.slug}/builds/${build.number}`
  const rejection = data.reviews.find((r) => r.state === 'rejected')
  return {
    title: defaultIssueTitle(snapshotName, build.number),
    description: issueDescription({
      number: build.number,
      project: `${project.orgSlug}/${project.slug}`,
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
