import type { Undo } from '@circi/api'
import { undoAction } from '@circi/services'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { loadTeam } from '#http/lib/team-access.ts'
import { parse } from '#http/lib/validation.ts'

const params = z.object({ id: z.uuid() })

/**
 * `POST /api/teams/:workspace/:team/undo/:id` and `POST /api/inbox/undo/:id`: takes back the
 * action whose answer carried that token. Only the person who did it (403 for anyone else, even
 * inside the team), once, within the token's window, and only while nothing newer changed the
 * same thing (409 with the reason in `error`, which the toast shows).
 */
export const dashboardUndoRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  const done: Undo.Done = { undone: true }

  app.post('/teams/:workspace/:team/undo/:id', async (req) => {
    const { id } = parse(params, req.params)
    const { team, user } = await loadTeam(deps, req)
    await undoAction(deps.db, { id, userId: user.id, teamId: team.id })
    return done
  })

  app.post('/inbox/undo/:id', async (req) => {
    const { id } = parse(params, req.params)
    await undoAction(deps.db, { id, userId: currentUser(req).id, teamId: null })
    return done
  })
}
