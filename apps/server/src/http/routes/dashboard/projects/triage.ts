import type { Triage } from '@circi/api'
import { TRIAGE_KINDS } from '@circi/core'
import { listTriage } from '@circi/db/queries'
import {
  assignTriageUndoable,
  dismissTriageUndoable,
  rerunFailedBuild,
  snoozeTriageUndoable,
  unsnoozeTriageUndoable,
} from '@circi/services'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import type { Deps } from '#http/lib/deps.ts'
import { loadProject } from '#http/lib/project-access.ts'
import { presentUndo } from '#http/lib/undo.ts'
import { parse } from '#http/lib/validation.ts'

const ref = { kind: z.enum(TRIAGE_KINDS), key: z.string().min(1).max(500) }
const assignBody = z.object({ ...ref, assigneeId: z.string().min(1).nullable() })
const snoozeBody = z.object({
  ...ref,
  /** Left out (or `date` without a date): the project's default number of days. */
  choice: z.enum(['next_push', 'tomorrow', 'next_week', 'date']).optional(),
  date: z.iso.datetime({ offset: true }).optional(),
})
const dismissBody = z.object(ref)
const rerunBody = z.object({ number: z.number().int().min(1) })

function state(
  item: {
    kind: Triage.Item['kind']
    key: string
    assigneeId: string | null
    assignmentSource: string | null
    snoozeKind: Triage.Item['snoozeKind']
    snoozedUntil: Date | null
    dismissedAt: Date | null
  },
  undo: Triage.ItemState['undo'],
): Triage.ItemState {
  return {
    undo,
    kind: item.kind,
    key: item.key,
    assigneeId: item.assigneeId,
    assigneeAuto: item.assignmentSource === 'auto',
    snoozeKind: item.snoozeKind,
    snoozedUntil: item.snoozedUntil?.toISOString() ?? null,
    dismissed: item.dismissedAt !== null,
  }
}

/**
 * A project's triage queue and what members do with it: assign, snooze, unsnooze, dismiss and, for a failed build, re-run its comparison. Any member of
 * the workspace may; everyone else gets "not found".
 */
export const dashboardTriageRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  app.get('/projects/:workspace/:project/triage', async (req) => {
    const found = await loadProject(deps, req)
    const queue = await listTriage(deps.db, { projectId: found.project.id, now: new Date() })
    const payload: Triage.Queue = {
      items: queue.items.map((i) =>
        Object.assign({}, i, {
          build: { ...i.build, createdAt: i.build.createdAt.toISOString() },
          snoozedUntil: i.snoozedUntil?.toISOString() ?? null,
        }),
      ),
      rotation: {
        ...queue.rotation,
        until: queue.rotation.until?.toISOString() ?? null,
      },
    }
    return payload
  })

  app.post('/projects/:workspace/:project/triage/assign', async (req) => {
    const found = await loadProject(deps, req)
    const body = parse(assignBody, req.body)
    const { item, undo } = await assignTriageUndoable(deps.db, {
      projectId: found.project.id,
      userId: found.user.id,
      ...body,
    })
    return state(item, presentUndo(undo))
  })

  app.post('/projects/:workspace/:project/triage/snooze', async (req) => {
    const found = await loadProject(deps, req)
    const { date, ...body } = parse(snoozeBody, req.body)
    const { item, undo } = await snoozeTriageUndoable(deps.db, {
      projectId: found.project.id,
      userId: found.user.id,
      ...body,
      ...(date ? { date: new Date(date) } : {}),
    })
    return state(item, presentUndo(undo))
  })

  /** Wakes a snoozed item early; an item that isn't snoozed comes back unchanged, with no undo. */
  app.post('/projects/:workspace/:project/triage/unsnooze', async (req) => {
    const found = await loadProject(deps, req)
    const body = parse(dismissBody, req.body)
    const { item, undo } = await unsnoozeTriageUndoable(deps.db, {
      projectId: found.project.id,
      userId: found.user.id,
      ...body,
    })
    return state(item, presentUndo(undo))
  })

  app.post('/projects/:workspace/:project/triage/dismiss', async (req) => {
    const found = await loadProject(deps, req)
    const body = parse(dismissBody, req.body)
    const { item, undo } = await dismissTriageUndoable(deps.db, {
      projectId: found.project.id,
      userId: found.user.id,
      ...body,
    })
    return state(item, presentUndo(undo))
  })

  /** Compares a failed build again; any member may, as with the `/circi rerun` comment. */
  app.post('/projects/:workspace/:project/triage/rerun', async (req) => {
    const found = await loadProject(deps, req)
    const { number } = parse(rerunBody, req.body)
    const build = await rerunFailedBuild(deps.db, { projectId: found.project.id, number })
    const payload: Triage.Rerun = { build }
    return payload
  })
}
