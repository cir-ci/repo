import { realpathSync } from 'node:fs'
import { basename } from 'node:path'

import type { InstanceAdmin } from '@circi/api'
import { getMoveChecklistDismissedFor, getQueueDepth } from '@circi/db/queries'
import { dismissMoveChecklist, restoreMoveChecklist } from '@circi/services'
import type { FastifyPluginAsync } from 'fastify'

import { instanceProbes } from '#composition/doctor-probes.ts'
import { httpFetcher, runDoctor } from '#composition/doctor.ts'
import { addressChecklist, withEffectiveSmtp } from '#composition/instance-settings.ts'
import { requireInstanceAdmin } from '#http/hooks/instance-admin.ts'
import type { Deps } from '#http/lib/deps.ts'

const realPaths = new Map<string, string>()

/**
 * The real path of a folder, or undefined when it can't be resolved (it doesn't exist yet). A
 * resolved path is kept: the storage folder is one per process, and this runs on every request.
 */
function realPathOf(path: string): string | undefined {
  const known = realPaths.get(path)
  if (known !== undefined) return known
  try {
    const real = realpathSync(path)
    realPaths.set(path, real)
    return real
  } catch {
    return undefined
  }
}

/**
 * Hides the server's folder layout from the browser: the storage folder shows as `…/<last folder>`
 * wherever the doctor's text names it, by the configured path or by its resolved real path (an
 * error from the disk names the real one: `/private/tmp/…` for `/tmp/…`). Only whole path
 * segments match, so a sibling like `/srv/data-old` is left alone. The CLI keeps the full path, it
 * runs on the server.
 */
export function hidePath(text: string, path: string | undefined): string
export function hidePath(text: string | null, path: string | undefined): string | null
export function hidePath(text: string | null, path: string | undefined): string | null {
  if (text === null || !path) return text
  const root = path.replace(/[\\/]+$/, '')
  if (!root) return text
  const label = `…/${basename(root)}`
  const real = realPathOf(root)
  const roots = [...new Set(real === undefined ? [root] : [root, real])].toSorted(
    (a, b) => b.length - a.length,
  )
  let result = text
  for (const r of roots) {
    const escaped = r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Not inside a longer name before it, and ending at a segment boundary after it: a name
    // character, or a dot or dash that goes on into one (`-old`, `.d`), continues the name; a
    // sentence's own "." or a trailing "-" does not.
    result = result.replace(new RegExp(`(?<![\\w.\\-/])${escaped}(?!\\w|[.\\-]\\w)`, 'g'), label)
  }
  return result
}

/** `/api/instance/health/…`: the doctor's checks, the address-change checklist, job queue depth. */
export const dashboardInstanceHealthRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  app.addHook('onRequest', requireInstanceAdmin())

  /** The same checks as `circi admin doctor` (it asks other hosts, so it can take a few seconds). */
  app.get('/instance/health/checks', async (_req, reply) => {
    if (!deps.instance) return reply.code(501).send({ error: "Health checks aren't available" })
    const config = deps.instanceConfig
      ? withEffectiveSmtp(deps.instance.config, await deps.instanceConfig.get())
      : deps.instance.config
    const found = await runDoctor(
      config,
      deps.instance.fetchHost ?? httpFetcher,
      deps.storage,
      instanceProbes({ db: deps.db, config, mailer: deps.instance.mailer }),
    )
    const root = config.storage?.driver === 'fs' ? config.storage.path : undefined
    const checks: InstanceAdmin.Checks = {
      findings: found.map((f): InstanceAdmin.Finding => ({
        id: f.id,
        level: f.level,
        label: f.label,
        detail: hidePath(f.detail, root),
        value: hidePath(f.value ?? null, root),
        message: hidePath(f.message, root),
        fix: hidePath(f.fix ?? null, root),
      })),
      warned: found.some((f) => f.level === 'warn' || f.level === 'fail'),
    }
    return checks
  })

  app.get('/instance/health/address-checklist', async (_req, reply) => {
    if (!deps.instance) return reply.code(501).send({ error: "The checklist isn't available" })
    const checklist = addressChecklist(deps.instance, deps, await deps.instanceConfig?.get())
    const dismissedFor = await getMoveChecklistDismissedFor(deps.db)
    const result: InstanceAdmin.AddressChecklist = {
      ...checklist,
      dismissed: dismissedFor === checklist.publicUrl,
      previousHosts: deps.instance.config.previousPublicHosts,
    }
    return result
  })

  /** Hides the checklist for the current address; a different `PUBLIC_URL` brings it back. */
  app.put('/instance/health/address-checklist/dismissed', async (_req, reply) => {
    if (!deps.instance) return reply.code(501).send({ error: "The checklist isn't available" })
    await dismissMoveChecklist(deps.db, deps.instance.config.publicUrl.origin)
    return reply.code(204).send()
  })

  /** Shows the checklist again. */
  app.delete('/instance/health/address-checklist/dismissed', async (_req, reply) => {
    await restoreMoveChecklist(deps.db)
    return reply.code(204).send()
  })

  app.get('/instance/health/queues', async (): Promise<InstanceAdmin.Queues> => {
    const depth = await getQueueDepth(deps.db)
    return {
      queues: depth.map((q): InstanceAdmin.QueueDepth => ({
        queue: q.queue,
        pending: q.pending,
        running: q.running,
        failed: q.failed,
        oldestPendingAt: q.oldestPendingAt?.toISOString() ?? null,
        retrying: q.retrying,
        mostRetried: q.mostRetried,
      })),
    }
  })
}
