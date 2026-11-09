import { createTeamWithToken, rotateTeamToken } from '@circi/auth'
import { listTeams } from '@circi/db/queries'
import type { Command } from 'commander'

import { printJson, printToken, publicTeam, withRuntime } from '#cli/lib/output.ts'

/** `circi admin team create|list|rotate-token` */
export function addTeamCommands(admin: Command): void {
  const team = admin.command('team').description('manage teams and their CI tokens')

  team
    .command('create')
    .description('create a team and print its CI token')
    .requiredOption('--org <slug>', 'organization slug')
    .requiredOption('--name <name>', 'display name, e.g. "Web app"')
    .option('--slug <slug>', 'URL name (default: derived from --name)')
    .option('--default-branch <branch>', 'branch whose builds become baselines', 'main')
    .option('--json', 'print JSON (includes the token)')
    .action(
      (opts: { org: string; name: string; slug?: string; defaultBranch: string; json?: boolean }) =>
        withRuntime(async (rt) => {
          const { team: p, token } = await createTeamWithToken(rt.auth, rt.db.db, {
            workspaceSlug: opts.org,
            name: opts.name,
            defaultBranch: opts.defaultBranch,
            ...(opts.slug ? { slug: opts.slug } : {}),
          })
          if (opts.json) return printJson({ team: publicTeam(p), token })
          console.log(`Created team ${opts.org}/${p.slug} (default branch: ${p.defaultBranch})`)
          printToken(token)
        }),
    )

  team
    .command('list')
    .description("list a workspace's teams")
    .requiredOption('--org <slug>', 'organization slug')
    .option('--json', 'print JSON')
    .action((opts: { org: string; json?: boolean }) =>
      withRuntime(async (rt) => {
        const teams = await listTeams(rt.db.db, opts.org)
        if (opts.json) return printJson(teams.map(publicTeam))
        if (teams.length === 0) return console.log(`No teams in ${opts.org} yet.`)
        for (const p of teams) {
          const token = p.ciKeyId ? 'token set' : 'no token (run rotate-token)'
          console.log(`${p.slug}\t${p.name}\tbranch=${p.defaultBranch}\t${token}`)
        }
      }),
    )

  team
    .command('rotate-token')
    .description('replace a team CI token (the old one stops working immediately)')
    .requiredOption('--org <slug>', 'organization slug')
    .requiredOption('--team <slug>', 'team slug')
    .option('--json', 'print JSON (includes the token)')
    .action((opts: { org: string; team: string; json?: boolean }) =>
      withRuntime(async (rt) => {
        const { team: p, token } = await rotateTeamToken(rt.auth, rt.db.db, {
          workspaceSlug: opts.org,
          teamSlug: opts.team,
        })
        if (opts.json) return printJson({ team: publicTeam(p), token })
        console.log(
          `Rotated the CI token for ${opts.org}/${p.slug}. The old token no longer works.`,
        )
        printToken(token)
      }),
    )
}
