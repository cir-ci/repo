import { addMember, createWorkspace } from '@circi/auth'
import { listWorkspaces } from '@circi/db/queries'
import type { Command } from 'commander'

import { printJson, withRuntime } from '#cli/lib/output.ts'
import { UsageError } from '#cli/lib/usage.ts'

/** `circi admin workspace create|list` */
export function addWorkspaceCommands(admin: Command): void {
  const workspace = admin.command('workspace').description('manage workspaces')

  workspace
    .command('create')
    .description('create a workspace')
    .requiredOption('--name <name>', 'display name, e.g. "Acme Inc"')
    .requiredOption('--owner <email>', 'email of an existing account that will own it')
    .option('--slug <slug>', 'URL name (default: derived from --name)')
    .option('--json', 'print JSON')
    .action((opts: { name: string; owner: string; slug?: string; json?: boolean }) =>
      withRuntime(async (rt) => {
        const created = await createWorkspace(rt.auth, rt.db.db, {
          name: opts.name,
          ownerEmail: opts.owner,
          ...(opts.slug ? { slug: opts.slug } : {}),
        })
        if (opts.json) return printJson(created)
        console.log(`Created workspace "${created.name}" (${created.slug}), owned by ${opts.owner}`)
      }),
    )

  workspace
    .command('list')
    .description('list workspaces')
    .option('--json', 'print JSON')
    .action((opts: { json?: boolean }) =>
      withRuntime(async (rt) => {
        const workspaces = await listWorkspaces(rt.db.db)
        if (opts.json) return printJson(workspaces)
        if (workspaces.length === 0) return console.log('No workspaces yet.')
        for (const o of workspaces) console.log(`${o.slug}\t${o.name}`)
      }),
    )
}

/** `circi admin member add` */
export function addMemberCommands(admin: Command): void {
  const member = admin.command('member').description('manage workspace members')

  member
    .command('add')
    .description('add an existing account to a workspace')
    .requiredOption('--org <slug>', 'organization slug')
    .requiredOption('--email <email>', 'account email')
    .option('--role <role>', 'owner, admin or member', 'member')
    .action((opts: { org: string; email: string; role: string }) =>
      withRuntime(async (rt) => {
        if (opts.role !== 'owner' && opts.role !== 'admin' && opts.role !== 'member') {
          throw new UsageError(`--role must be owner, admin or member (got "${opts.role}")`)
        }
        await addMember(rt.auth, rt.db.db, {
          workspaceSlug: opts.org,
          email: opts.email,
          role: opts.role,
        })
        console.log(`Added ${opts.email} to ${opts.org} as ${opts.role}`)
      }),
    )
}
