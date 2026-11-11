import type { ReviewRule, Triage } from '@circi/api'
import { canManage } from '@circi/core'
import { getProjectMemberRole, getTriageRotation, listReviewRules } from '@circi/db/queries'
import {
  addReviewRule,
  editReviewRule,
  orderReviewRules,
  removeReviewRule,
  replaceTriageRotation,
} from '@circi/services'
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
const orderBody = z.object({ ruleIds: z.array(z.uuid()).max(500) })
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
 * workspace gets "not found".
 */
export const dashboardRuleRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  app.get('/projects/:workspace/:project/rules', async (req) => {
    const found = await loadProject(deps, req)
    const role = await getProjectMemberRole(deps.db, found.project.id, found.user.id)
    const settings: ReviewRule.Settings = {
      canManage: canManage(role),
      rules: await listReviewRules(deps.db, found.project.id),
      rotation: presentRotation(await getTriageRotation(deps.db, found.project.id)),
    }
    return settings
  })

  app.post('/projects/:workspace/:project/rules', async (req, reply) => {
    const found = await loadProject(deps, req, { manage: true })
    const body = parse(ruleBody, req.body)
    const rule = await addReviewRule(deps.db, { projectId: found.project.id, ...body })
    return reply.code(201).send(rule)
  })

  /** Puts the rules in the given order (every rule once); the first match wins. */
  app.put('/projects/:workspace/:project/rules/order', async (req) => {
    const found = await loadProject(deps, req, { manage: true })
    const body = parse(orderBody, req.body)
    const rules: ReviewRule.Item[] = await orderReviewRules(deps.db, found.project.id, body.ruleIds)
    return { rules }
  })

  app.put('/projects/:workspace/:project/rules/:id', async (req, reply) => {
    const found = await loadProject(deps, req, { manage: true })
    const { id } = parse(ruleParams, req.params)
    if (!z.uuid().safeParse(id).success) return reply.code(404).send({ error: 'Rule not found' })
    const body = parse(ruleBody, req.body)
    return editReviewRule(deps.db, { projectId: found.project.id, id, ...body })
  })

  app.delete('/projects/:workspace/:project/rules/:id', async (req, reply) => {
    const found = await loadProject(deps, req, { manage: true })
    const { id } = parse(ruleParams, req.params)
    if (!z.uuid().safeParse(id).success) return reply.code(404).send({ error: 'Rule not found' })
    await removeReviewRule(deps.db, found.project.id, id)
    return reply.code(204).send()
  })

  /** Replaces the rotation; an empty list turns it off. */
  app.put('/projects/:workspace/:project/triage-rotation', async (req) => {
    const found = await loadProject(deps, req, { manage: true })
    const body = parse(rotationBody, req.body)
    const rotation = await replaceTriageRotation(deps.db, {
      projectId: found.project.id,
      memberIds: body.memberIds,
      ...(body.startsOn ? { startsOn: new Date(body.startsOn) } : {}),
    })
    return presentRotation(rotation)
  })
}
