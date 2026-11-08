import type { Build, ProjectContext } from '@circi/db'

/** The build summary every `/v1` response uses, with a link to its dashboard page. */
export function describeBuild(
  ctx: ProjectContext,
  build: Pick<Build, 'id' | 'number' | 'name' | 'status' | 'conclusion' | 'reviewStatus'>,
  publicOrigin: string,
) {
  return {
    id: build.id,
    number: build.number,
    name: build.name,
    status: build.status,
    conclusion: build.conclusion,
    reviewStatus: build.reviewStatus,
    url: `${publicOrigin}/${ctx.orgSlug}/${ctx.project.slug}/builds/${build.number}`,
  }
}
