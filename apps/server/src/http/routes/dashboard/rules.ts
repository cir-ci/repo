import type { ReviewRule, Triage } from '@circi/api'
import {
  createReviewRule,
  deleteReviewRule,
  getProjectMemberRole,
  getTriageRotation,
  listReviewRules,
  setTriageRotation,
  updateReviewRule,
} from '@circi/db'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import type { Deps } from '#http/lib/deps.ts'
import { loadProject } from '#http/lib/project-access.ts'
import { parse } from '#http/lib/validation.ts'

const ruleBody = z.object({
  kind: z.enum(['snapshot-name', 'build-name']),
  pattern: z.string().max(200),
  reviewerIds: z.array(z.string().min(1)).max(20),
})
const ruleParams = z.object({ id: z.string() })
const rotationBody = z.object({
  memberIds: z.array(z.string().min(1)).max(50),
  /** ISO date or time of the rotation's first week; defaults to now. */
  startsOn: z.iso.datetime({ offset: true }).optional(),
})

const presentRotation = (r: Awaited<ReturnType<typeof getTriageRotation>>): Triage.Rotation => ({
  startsOn: r.startsOn?.toISOString() ?? null,
  members: r.members,
})

/**
 * A project's review rules (who is asked to review which snapshots or builds) and its triage
 * rotation. Every member can look; owners and admins change them, and anyone outside the
 * organization gets "not found".
 */
export const dashboardRuleRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  app.get('/projects/:org/:project/rules', async (req, reply) => {
    const found = await loadProject(deps, req, reply)
    if (!found) return reply
    const role = await getProjectMemberRole(deps.db, found.project.id, found.user.id)
    const settings: ReviewRule.Settings = {
      canManage: role === 'owner' || role === 'admin',
      rules: await listReviewRules(deps.db, found.project.id),
      rotation: presentRotation(await getTriageRotation(deps.db, found.project.id)),
    }
    return settings
  })

  app.post('/projects/:org/:project/rules', async (req, reply) => {
    const found = await loadProject(deps, req, reply, { manage: true })
    if (!found) return reply
    const body = parse(ruleBody, req.body)
    const rule = await createReviewRule(deps.db, { projectId: found.project.id, ...body })
    return reply.code(201).send(rule)
  })

  app.put('/projects/:org/:project/rules/:id', async (req, reply) => {
    const found = await loadProject(deps, req, reply, { manage: true })
    if (!found) return reply
    const { id } = parse(ruleParams, req.params)
    if (!z.uuid().safeParse(id).success) return reply.code(404).send({ error: 'Rule not found' })
    const body = parse(ruleBody, req.body)
    return updateReviewRule(deps.db, { projectId: found.project.id, id, ...body })
  })

  app.delete('/projects/:org/:project/rules/:id', async (req, reply) => {
    const found = await loadProject(deps, req, reply, { manage: true })
    if (!found) return reply
    const { id } = parse(ruleParams, req.params)
    if (!z.uuid().safeParse(id).success) return reply.code(404).send({ error: 'Rule not found' })
    await deleteReviewRule(deps.db, found.project.id, id)
    return reply.code(204).send()
  })

  /** Replaces the rotation; an empty list turns it off. */
  app.put('/projects/:org/:project/triage-rotation', async (req, reply) => {
    const found = await loadProject(deps, req, reply, { manage: true })
    if (!found) return reply
    const body = parse(rotationBody, req.body)
    const rotation = await setTriageRotation(deps.db, {
      projectId: found.project.id,
      memberIds: body.memberIds,
      ...(body.startsOn ? { startsOn: new Date(body.startsOn) } : {}),
    })
    return presentRotation(rotation)
  })
}
