import type { Build, Issue } from '@circi/api'
import { defaultIssueTitle, issueDescription } from '@circi/core/issues'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { getJson, post, seg } from '#lib/http.ts'

import { fileUrl } from './index.ts'

const base = (workspace: string, team: string, number: number) =>
  `/api/teams/${seg(workspace)}/${seg(team)}/builds/${number}/issues`

/** The issues created from a build and the trackers its team files issues in (none: no "Create issue"). */
export const issuesQuery = (workspace: string, team: string, number: number) =>
  queryOptions({
    queryKey: ['issues', workspace, team, number],
    queryFn: () => getJson<Issue.List>(base(workspace, team, number)),
  })

/** Creates an issue; the build page, its issues and its activity refresh afterwards. */
export function useCreateIssue(workspace: string, team: string, number: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Issue.Create) => post<Issue.Ref>(base(workspace, team, number), input),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['issues', workspace, team, number] }),
        queryClient.invalidateQueries({ queryKey: ['build', workspace, team, number] }),
        queryClient.invalidateQueries({ queryKey: ['activity', workspace, team, number] }),
      ]),
  })
}

/**
 * The title and description the server will use, for the dialog's preview: the same text, from
 * the same function, as the service builds (`@circi/core`). `origin` is where the dashboard is
 * served (the server uses its configured public address, which is the same place).
 */
export function issuePreview(
  data: Pick<Build.Detail, 'team' | 'build' | 'reviews' | 'diffs'>,
  snapshotName: string | null,
  origin: string,
): { title: string; description: string } {
  const { build, team } = data
  const shot = snapshotName ? data.diffs.find((d) => d.name === snapshotName) : undefined
  const sha = shot?.diff?.sha256 ?? shot?.head?.sha256 ?? null
  const buildUrl = `${origin}/${team.workspaceSlug}/${team.slug}/builds/${build.number}`
  const rejection = data.reviews.find((r) => r.state === 'rejected')
  return {
    title: defaultIssueTitle(snapshotName, build.number),
    description: issueDescription({
      number: build.number,
      team: `${team.workspaceSlug}/${team.slug}`,
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
