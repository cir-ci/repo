import type { Review } from '@circi/api'
import { listReviewRequests, REVIEW_TABS } from '@circi/db/queries'
import {
  dismissReviewRequest,
  snoozeReviewRequest,
  unsnoozeReviewRequest,
  requestReview,
} from '@circi/services'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { loadBuild, loadTeam } from '#http/lib/team-access.ts'
import { parse } from '#http/lib/validation.ts'

const listQuery = z.object({ tab: z.enum(REVIEW_TABS).default('for-you') })
const teamParams = z.object({ workspace: z.string(), team: z.string() })
const requestBody = z.object({ reviewerId: z.string().min(1) })
const dismissParams = teamParams.extend({ id: z.string().uuid() })

/**
 * Review requests (who was asked to look at which build). The list spans the signed-in user's
 * workspaces; asking and dropping a request work on one team's builds. Everyone outside
 * the workspace gets "not found", as everywhere else on the dashboard.
 */
export const dashboardReviewRequestRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
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
          closedAt: r.closedAt?.toISOString() ?? null,
        }),
      ),
    }
  })

  /** Any member may ask any other member of the workspace to review; asking yourself is a 400. */
  app.post('/teams/:workspace/:team/builds/:number/review-requests', async (req, reply) => {
    const { reviewerId } = parse(requestBody, req.body)
    const { build, user } = await loadBuild(deps, req, { notFound: 'Build not found' })

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
  app.post('/teams/:workspace/:team/review-requests/:id/dismiss', async (req, reply) => {
    const p = parse(dismissParams, req.params)
    const { team, user } = await loadTeam(deps, req, { notFound: 'Review request not found' })
    const dismissed = await dismissReviewRequest(deps.db, {
      teamId: team.id,
      requestId: p.id,
      userId: user.id,
    })
    if (!dismissed) return reply.code(404).send({ error: 'Review request not found' })
    return { id: dismissed.id, state: dismissed.state }
  })

  const snoozeBody = z.object({
    kind: z.enum(['next_push', 'tomorrow', 'next_week', 'date']),
    date: z.coerce.date().optional(),
  })

  /** Only the reviewer may put an open request off, or bring it back. */
  app.post('/teams/:workspace/:team/review-requests/:id/snooze', async (req) => {
    const p = parse(dismissParams, req.params)
    const { kind, date } = parse(snoozeBody, req.body)
    const { team, user } = await loadTeam(deps, req, { notFound: 'Review request not found' })
    const row = await snoozeReviewRequest(deps.db, {
      teamId: team.id,
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

  app.post('/teams/:workspace/:team/review-requests/:id/unsnooze', async (req) => {
    const p = parse(dismissParams, req.params)
    const { team, user } = await loadTeam(deps, req, { notFound: 'Review request not found' })
    const row = await unsnoozeReviewRequest(deps.db, {
      teamId: team.id,
      requestId: p.id,
      userId: user.id,
    })
    return { id: row.id, snoozeKind: row.snoozeKind, snoozedUntil: null }
  })
}
