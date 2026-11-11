import type { Review } from '@circi/api'
import {
  MAX_BULK_REQUEST_REVIEW,
  MAX_BULK_REVIEW,
  requestReviewsUndoable,
  reviewBuilds,
  reviewBuildUndoable,
  reviewSnapshotsUndoable,
} from '@circi/services'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import type { Deps } from '#http/lib/deps.ts'
import { loadBuild, loadProject } from '#http/lib/project-access.ts'
import { presentUndo } from '#http/lib/undo.ts'
import { parse } from '#http/lib/validation.ts'

const body = z.object({
  state: z.enum(['approved', 'rejected']),
  /** Why the changes were rejected; the build's author sees it in their inbox. */
  reason: z.string().trim().max(2000).optional(),
})

/**
 * `POST …/builds/:number/review`: approve or reject a build's changes. Any member of the
 * project's workspace may decide; everyone else gets the same "not found" as for a build
 * that doesn't exist. Decisions can be changed, and the latest one counts.
 */
export const dashboardReviewRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  app.post('/projects/:workspace/:project/builds/:number/review', async (req) => {
    const { state, reason } = parse(body, req.body)
    const { build, user, project } = await loadBuild(deps, req, { notFound: 'Build not found' })

    const { build: updated, undo } = await reviewBuildUndoable(deps.db, {
      buildId: build.id,
      projectId: project.id,
      userId: user.id,
      state,
      ...(reason ? { reason } : {}),
    })
    const payload: Review.Decided = {
      build: {
        number: updated.number,
        status: updated.status,
        conclusion: updated.conclusion,
        reviewStatus: updated.reviewStatus,
      },
      undo: presentUndo(undo),
    }
    return payload
  })

  /**
   * `POST …/builds/:number/snapshots/review`: approve or reject some snapshots of a build.
   * Members decide as for the whole build; the build's status follows from the decisions.
   */
  app.post('/projects/:workspace/:project/builds/:number/snapshots/review', async (req) => {
    const { snapshotNames, decision, reason } = parse(snapshotsBody, req.body)
    const { build, user, project } = await loadBuild(deps, req, { notFound: 'Build not found' })

    const { build: updated, undo } = await reviewSnapshotsUndoable(deps.db, {
      buildId: build.id,
      projectId: project.id,
      userId: user.id,
      decision,
      snapshotNames,
      ...(reason ? { reason } : {}),
    })
    const payload: Review.Decided = {
      build: {
        number: updated.number,
        status: updated.status,
        conclusion: updated.conclusion,
        reviewStatus: updated.reviewStatus,
      },
      undo: presentUndo(undo),
    }
    return payload
  })
}

const snapshotsBody = z.object({
  /** Some screenshots by name, or `undecided`: every changed one with no decision yet. */
  snapshotNames: z.union([
    z.array(z.string().min(1).max(500)).min(1).max(1000),
    z.literal('undecided'),
  ]),
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().trim().max(2000).optional(),
})

const bulkBody = z.object({
  buildIds: z.array(z.string().uuid()).min(1).max(MAX_BULK_REVIEW),
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().max(2000).optional(),
})

/**
 * `POST …/builds/review`: approve or reject several builds of a project at once. All or
 * nothing: an id that isn't a build of the project (or can't be reviewed) fails the call.
 */
export const dashboardBulkReviewRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  app.post('/projects/:workspace/:project/builds/review', async (req) => {
    const input = parse(bulkBody, req.body)
    const { project, user } = await loadProject(deps, req)
    const { builds } = await reviewBuilds(deps.db, {
      projectId: project.id,
      buildIds: input.buildIds,
      userId: user.id,
      state: input.decision,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    })
    return {
      builds: builds.map((b) => ({
        number: b.number,
        status: b.status,
        conclusion: b.conclusion,
        reviewStatus: b.reviewStatus,
      })),
    }
  })

  /**
   * `POST …/builds/request-review`: ask each reviewer to review each build, in one transaction.
   * All or nothing, like the bulk decision above. Any member may ask.
   */
  app.post('/projects/:workspace/:project/builds/request-review', async (req) => {
    const input = parse(requestBulkBody, req.body)
    const found = await loadProject(deps, req)
    const { project, user } = found
    const { requests, undo } = await requestReviewsUndoable(deps.db, {
      projectId: project.id,
      buildIds: input.buildIds,
      reviewerIds: input.reviewerIds,
      requestedById: user.id,
    })
    const payload: Review.BulkRequested = {
      requests: requests.map((r) => ({
        buildId: r.buildId,
        reviewerId: r.reviewerId,
        id: r.request.id,
        state: r.request.state,
        dueAt: r.request.dueAt?.toISOString() ?? null,
        created: r.created,
      })),
      undo: presentUndo(undo),
    }
    return payload
  })
}

const requestBulkBody = z.object({
  buildIds: z.array(z.string().uuid()).min(1).max(MAX_BULK_REQUEST_REVIEW),
  reviewerIds: z.array(z.string().min(1)).min(1).max(20),
})
