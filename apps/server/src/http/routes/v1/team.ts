import type { FastifyPluginAsync } from 'fastify'

import { currentTeam } from '#http/hooks/team-token.ts'
import type { Deps } from '#http/lib/deps.ts'

/** `GET /v1/team`: what the CLI needs to know about the token's team. */
export const teamRoutes: FastifyPluginAsync<Deps.V1> = async (app, deps) => {
  app.get('/team', async (req) => {
    const { team, workspaceSlug } = currentTeam(req)
    return {
      workspace: workspaceSlug,
      slug: team.slug,
      name: team.name,
      defaultBranch: team.defaultBranch,
      dashboardUrl: `${deps.publicOrigin}/${workspaceSlug}/${team.slug}`,
    }
  })
}
