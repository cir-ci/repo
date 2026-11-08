import type { Review } from '@circi/api'
import { findProjectForMember, getBuildByNumber, listReviewRequests, REVIEW_TABS } from '@circi/db'
import {
  dismissReviewRequest,
  MAX_BULK_REVIEW,
  requestReview,
  reviewBuild,
  reviewBuilds,
  snoozeReviewRequest,
  unsnoozeReviewRequest,
} from '@circi/services'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { currentUser } from '../../hooks/session.ts'
import type { DashboardDeps } from '../../lib/deps.ts'
import { parse } from '../../lib/validation.ts'

const params = z.object({ org: z.string(), project: z.string(), number: z.string() })
const body = z.object({
  state: z.enum(['approved', 'rejected']),
  /** Why the changes were rejected; the build's author sees it in their inbox. */
  reason: z.string().trim().max(2000).optional(),
})

/**
 * `POST …/builds/:number/review`: approve or reject a build's changes. Any member of the
 * project's organization may decide; everyone else gets the same "not found" as for a build
 * that doesn't exist. Decisions can be changed, and the latest one counts.
 */
export const dashboardReviewRoutes: FastifyPluginAsync<DashboardDeps> = async (app, deps) => {
  app.post('/projects/:org/:project/builds/:number/review', async (req, reply) => {
    const p = parse(params, req.params)
    const { state, reason } = parse(body, req.body)
    const user = currentUser(req)
    const project = await findProjectForMember(deps.db, {
      orgSlug: p.org,
      projectSlug: p.project,
      userId: user.id,
      method: user.method,
    })
    const number = Number(p.number)
    const build =
      project && Number.isInteger(number)
        ? await getBuildByNumber(deps.db, project.id, number)
        : undefined
    if (!build) return reply.code(404).send({ error: 'Build not found' })

    const updated = await reviewBuild(deps.db, {
      buildId: build.id,
      userId: user.id,
      state,
      ...(reason ? { reason } : {}),
    })
    return {
      build: {
        number: updated.number,
        status: updated.status,
        conclusion: updated.conclusion,
        reviewStatus: updated.reviewStatus,
      },
    }
  })
}

const bulkBody = z.object({
  buildIds: z.array(z.string().uuid()).min(1).max(MAX_BULK_REVIEW),
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().max(2000).optional(),
})
const bulkParams = z.object({ org: z.string(), project: z.string() })

/**
 * `POST …/builds/review`: approve or reject several builds of a project at once. All or
 * nothing: an id that isn't a build of the project (or can't be reviewed) fails the call.
 */
export const dashboardBulkReviewRoutes: FastifyPluginAsync<DashboardDeps> = async (app, deps) => {
  app.post('/projects/:org/:project/builds/review', async (req, reply) => {
    const p = parse(bulkParams, req.params)
    const input = parse(bulkBody, req.body)
    const user = currentUser(req)
    const project = await findProjectForMember(deps.db, {
      orgSlug: p.org,
      projectSlug: p.project,
      userId: user.id,
      method: user.method,
    })
    if (!project) return reply.code(404).send({ error: 'Project not found' })
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
}

const listQuery = z.object({ tab: z.enum(REVIEW_TABS).default('for-you') })
const projectParams = z.object({ org: z.string(), project: z.string() })
const requestBody = z.object({ reviewerId: z.string().min(1) })
const dismissParams = projectParams.extend({ id: z.string().uuid() })

/**
 * Review requests (who was asked to look at which build). The list spans the signed-in user's
 * organizations; asking and dropping a request work on one project's builds. Everyone outside
 * the organization gets "not found", as everywhere else on the dashboard.
 */
export const dashboardReviewRequestRoutes: FastifyPluginAsync<DashboardDeps> = async (
  app,
  deps,
) => {
  app.get('/reviews', async (req): Promise<Review.List> => {
    const { tab } = parse(listQuery, req.query)
    const user = currentUser(req)
    const items = await listReviewRequests(deps.db, {
      userId: user.id,
      tab,
      now: new Date(),
      method: user.method,
    })
    return {
      tab,
      requests: items.map((r) =>
        Object.assign({}, r, {
          createdAt: r.createdAt.toISOString(),
          dueAt: r.dueAt?.toISOString() ?? null,
          snoozedUntil: r.snoozedUntil?.toISOString() ?? null,
        }),
      ),
    }
  })

  /** Any member may ask any member of the organization (including themselves) to review. */
  app.post('/projects/:org/:project/builds/:number/review-requests', async (req, reply) => {
    const p = parse(projectParams.extend({ number: z.string() }), req.params)
    const { reviewerId } = parse(requestBody, req.body)
    const user = currentUser(req)
    const project = await findProjectForMember(deps.db, {
      orgSlug: p.org,
      projectSlug: p.project,
      userId: user.id,
      method: user.method,
    })
    const number = Number(p.number)
    const build =
      project && Number.isInteger(number)
        ? await getBuildByNumber(deps.db, project.id, number)
        : undefined
    if (!build) return reply.code(404).send({ error: 'Build not found' })

    const { request, created } = await requestReview(deps.db, {
      buildId: build.id,
      reviewerId,
      requestedById: user.id,
    })
    const payload: Review.Requested = {
      id: request.id,
      state: request.state,
      dueAt: request.dueAt?.toISOString() ?? null,
      created,
    }
    return reply.code(created ? 201 : 200).send(payload)
  })

  /** The reviewer or whoever asked may drop an open request. */
  app.post('/projects/:org/:project/review-requests/:id/dismiss', async (req, reply) => {
    const p = parse(dismissParams, req.params)
    const user = currentUser(req)
    const project = await findProjectForMember(deps.db, {
      orgSlug: p.org,
      projectSlug: p.project,
      userId: user.id,
      method: user.method,
    })
    const dismissed = project
      ? await dismissReviewRequest(deps.db, {
          projectId: project.id,
          requestId: p.id,
          userId: user.id,
        })
      : undefined
    if (!dismissed) return reply.code(404).send({ error: 'Review request not found' })
    return { id: dismissed.id, state: dismissed.state }
  })

  const snoozeBody = z.object({
    kind: z.enum(['next_push', 'tomorrow', 'next_week', 'date']),
    date: z.coerce.date().optional(),
  })

  /** Only the reviewer may put an open request off, or bring it back. */
  app.post('/projects/:org/:project/review-requests/:id/snooze', async (req, reply) => {
    const p = parse(dismissParams, req.params)
    const { kind, date } = parse(snoozeBody, req.body)
    const user = currentUser(req)
    const project = await findProjectForMember(deps.db, {
      orgSlug: p.org,
      projectSlug: p.project,
      userId: user.id,
      method: user.method,
    })
    if (!project) return reply.code(404).send({ error: 'Review request not found' })
    const row = await snoozeReviewRequest(deps.db, {
      projectId: project.id,
      requestId: p.id,
      userId: user.id,
      kind,
      ...(date ? { date } : {}),
    })
    return {
      id: row.id,
      snoozeKind: row.snoozeKind,
      snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
    }
  })

  app.post('/projects/:org/:project/review-requests/:id/unsnooze', async (req, reply) => {
    const p = parse(dismissParams, req.params)
    const user = currentUser(req)
    const project = await findProjectForMember(deps.db, {
      orgSlug: p.org,
      projectSlug: p.project,
      userId: user.id,
      method: user.method,
    })
    if (!project) return reply.code(404).send({ error: 'Review request not found' })
    const row = await unsnoozeReviewRequest(deps.db, {
      projectId: project.id,
      requestId: p.id,
      userId: user.id,
    })
    return { id: row.id, snoozeKind: row.snoozeKind, snoozedUntil: null }
  })
}
