import type { FastifyPluginAsync } from 'fastify'

import { currentProject } from '#http/hooks/project-token.ts'
import type { Deps } from '#http/lib/deps.ts'

/** `GET /v1/project`: what the CLI needs to know about the token's project. */
export const projectRoutes: FastifyPluginAsync<Deps.V1> = async (app, deps) => {
  app.get('/project', async (req) => {
    const { project, workspaceSlug } = currentProject(req)
    return {
      workspace: workspaceSlug,
      slug: project.slug,
      name: project.name,
      defaultBranch: project.defaultBranch,
      dashboardUrl: `${deps.publicOrigin}/${workspaceSlug}/${project.slug}`,
    }
  })
}
