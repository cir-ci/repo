import { isWebhookEvent, WEBHOOK_EVENTS, webhookUrlProblem } from '@circi/core/node'
import { listWebhooks } from '@circi/db/queries'
import { addWebhook, removeWebhook } from '@circi/services'
import type { Command } from 'commander'

import { printJson, withRuntime } from '#cli/lib/output.ts'
import { teamOf } from '#cli/lib/team.ts'

/** `circi admin webhook add|list|remove` */
export function addWebhookCommands(admin: Command): void {
  const webhook = admin.command('webhook').description('manage outgoing webhooks of a team')

  webhook
    .command('add')
    .description('send signed events of a team to a URL (the secret is printed once)')
    .requiredOption('--org <slug>', 'organization slug')
    .requiredOption('--team <slug>', 'team slug')
    .requiredOption('--url <url>', 'http(s) address that receives POSTs')
    .requiredOption('--events <list>', `comma-separated, from: ${WEBHOOK_EVENTS.join(', ')}`)
    .option('--json', 'print JSON (includes the secret)')
    .action((opts: { org: string; team: string; url: string; events: string; json?: boolean }) =>
      withRuntime(async (rt) => {
        const problem = webhookUrlProblem(opts.url, {
          allowPrivate: rt.config.webhookAllowPrivate,
        })
        if (problem) throw new Error(`--url: ${problem}`)
        const url = new URL(opts.url)
        const events = opts.events
          .split(',')
          .map((e) => e.trim())
          .filter(Boolean)
        if (events.length === 0) throw new Error('--events: choose at least one event')
        const unknown = events.filter((e) => !isWebhookEvent(e))
        if (unknown.length > 0) throw new Error(`Unknown event(s): ${unknown.join(', ')}`)
        const team = await teamOf(rt, opts.org, opts.team)
        const created = await addWebhook(rt.db.db, {
          teamId: team.id,
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
    .description("list a team's webhooks")
    .requiredOption('--org <slug>', 'organization slug')
    .requiredOption('--team <slug>', 'team slug')
    .action((opts: { org: string; team: string }) =>
      withRuntime(async (rt) => {
        const team = await teamOf(rt, opts.org, opts.team)
        const hooks = await listWebhooks(rt.db.db, team.id)
        if (hooks.length === 0) return console.log('No webhooks yet.')
        for (const h of hooks) console.log(`${h.id}\t${h.url}\t${h.events.join(',')}`)
      }),
    )

  webhook
    .command('remove')
    .description('stop sending to a webhook')
    .requiredOption('--org <slug>', 'organization slug')
    .requiredOption('--team <slug>', 'team slug')
    .requiredOption('--id <id>', 'webhook id from `webhook list`')
    .action((opts: { org: string; team: string; id: string }) =>
      withRuntime(async (rt) => {
        const team = await teamOf(rt, opts.org, opts.team)
        await removeWebhook(rt.db.db, team.id, opts.id)
        console.log('Removed.')
      }),
    )
}
