import type { FastifyPluginAsync } from 'fastify'

import type { V1Deps } from '../../deps.ts'
import { currentProject } from '../../hooks/project-token.ts'

/** `GET /v1/project`: what the CLI needs to know about the token's project. */
export const projectRoutes: FastifyPluginAsync<V1Deps> = async (app, deps) => {
  app.get('/project', async (req) => {
    const { project, orgSlug } = currentProject(req)
    return {
      org: orgSlug,
      slug: project.slug,
      name: project.name,
      defaultBranch: project.defaultBranch,
      dashboardUrl: `${deps.publicOrigin}/${orgSlug}/${project.slug}`,
    }
  })
}
