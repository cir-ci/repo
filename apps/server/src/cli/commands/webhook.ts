import { isWebhookEvent, WEBHOOK_EVENTS, webhookUrlProblem } from '@circi/core/node'
import { listWebhooks } from '@circi/db/queries'
import { addWebhook, removeWebhook } from '@circi/services'
import type { Command } from 'commander'

import { printJson, withRuntime } from '#cli/lib/output.ts'
import { projectOf } from '#cli/lib/project.ts'
import { UsageError } from '#cli/lib/usage.ts'

/** `circi admin webhook add|list|remove` */
export function addWebhookCommands(admin: Command): void {
  const webhook = admin.command('webhook').description('manage outgoing webhooks of a project')

  webhook
    .command('add')
    .description('send signed events of a project to a URL (the secret is printed once)')
    .requiredOption('--org <slug>', 'organization slug')
    .requiredOption('--project <slug>', 'project slug')
    .requiredOption('--url <url>', 'http(s) address that receives POSTs')
    .requiredOption('--events <list>', `comma-separated, from: ${WEBHOOK_EVENTS.join(', ')}`)
    .option('--json', 'print JSON (includes the secret)')
    .action((opts: { org: string; project: string; url: string; events: string; json?: boolean }) =>
      withRuntime(async (rt) => {
        const problem = webhookUrlProblem(opts.url, {
          allowPrivate: rt.config.webhookAllowPrivate,
        })
        if (problem) throw new UsageError(`--url: ${problem}`)
        const url = new URL(opts.url)
        const events = opts.events
          .split(',')
          .map((e) => e.trim())
          .filter(Boolean)
        if (events.length === 0) throw new UsageError('--events: choose at least one event')
        const unknown = events.filter((e) => !isWebhookEvent(e))
        if (unknown.length > 0) throw new UsageError(`Unknown event(s): ${unknown.join(', ')}`)
        const project = await projectOf(rt, opts.org, opts.project)
        const created = await addWebhook(rt.db.db, {
          projectId: project.id,
          url: url.toString(),
          events: events.filter(isWebhookEvent),
        })
        if (opts.json) return printJson(created)
        console.log(`Added webhook ${created.id} → ${created.url} (${created.events.join(', ')})`)
        console.log('\nSigning secret (shown once, verify CirCI-Signature with it):')
        console.log(`  ${created.secret}`)
      }),
    )

  webhook
    .command('list')
    .description("list a project's webhooks")
    .requiredOption('--org <slug>', 'organization slug')
    .requiredOption('--project <slug>', 'project slug')
    .action((opts: { org: string; project: string }) =>
      withRuntime(async (rt) => {
        const project = await projectOf(rt, opts.org, opts.project)
        const hooks = await listWebhooks(rt.db.db, project.id)
        if (hooks.length === 0) return console.log('No webhooks yet.')
        for (const h of hooks) console.log(`${h.id}\t${h.url}\t${h.events.join(',')}`)
      }),
    )

  webhook
    .command('remove')
    .description('stop sending to a webhook')
    .requiredOption('--org <slug>', 'organization slug')
    .requiredOption('--project <slug>', 'project slug')
    .requiredOption('--id <id>', 'webhook id from `webhook list`')
    .action((opts: { org: string; project: string; id: string }) =>
      withRuntime(async (rt) => {
        const project = await projectOf(rt, opts.org, opts.project)
        await removeWebhook(rt.db.db, project.id, opts.id)
        console.log('Removed.')
      }),
    )
}
