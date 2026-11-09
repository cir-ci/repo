import type { Build } from '@circi/db'
import type { getTeamContext } from '@circi/db/queries'

/** The build summary every `/v1` response uses, with a link to its dashboard page. */
export function describeBuild(
  ctx: getTeamContext.Context,
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
    url: `${publicOrigin}/${ctx.workspaceSlug}/${ctx.team.slug}/builds/${build.number}`,
  }
}
