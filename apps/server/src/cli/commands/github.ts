import { linkTeamToGithub, unlinkTeamFromGit } from '@circi/services'
import type { Command } from 'commander'

import { withRuntime } from '#cli/lib/output.ts'
import { teamOf } from '#cli/lib/team.ts'
import { useStoredGithubApp } from '#composition/github-app.ts'
import { integrationConfig } from '#composition/integration-config.ts'

/** `circi admin github link|unlink` */
export function addGithubCommands(admin: Command): void {
  const github = admin.command('github').description('link teams to GitHub repositories')

  github
    .command('link')
    .description(
      "report a team's builds to a GitHub repository (needs the GitHub App installed on it)",
    )
    .requiredOption('--org <slug>', 'organization slug')
    .requiredOption('--team <slug>', 'team slug')
    .requiredOption('--repo <owner/name>', 'the repository')
    .requiredOption('--installation <id>', 'the GitHub App installation id (see its URL on GitHub)')
    .action((opts: { org: string; team: string; repo: string; installation: string }) =>
      withRuntime(async (rt) => {
        if (!/^[\w.-]+\/[\w.-]+$/.test(opts.repo))
          throw new Error('--repo must look like owner/name')
        if (!/^\d+$/.test(opts.installation)) throw new Error('--installation must be a number')
        const team = await teamOf(rt, opts.org, opts.team)
        // The App from the environment, or the one created in the dashboard.
        const config = integrationConfig(rt.config)
        if (!rt.config.github) await useStoredGithubApp(rt.db.db, rt.config.authSecret, config)
        if (!config.github) {
          throw new Error('No GitHub App is configured (GITHUB_APP_*, or create one in Instance)')
        }
        // Verified with GitHub like the dashboard's Add flow; nothing is stored when it fails.
        await linkTeamToGithub(
          rt.db.db,
          team.id,
          { installationId: opts.installation, repoRef: opts.repo },
          {
            authSecret: rt.config.authSecret,
            publicOrigin: rt.config.publicUrl.origin,
            config,
          },
        )
        console.log(`${opts.org}/${opts.team} now reports to ${opts.repo}`)
      }),
    )

  github
    .command('unlink')
    .description('stop reporting a team to GitHub')
    .requiredOption('--org <slug>', 'organization slug')
    .requiredOption('--team <slug>', 'team slug')
    .action((opts: { org: string; team: string }) =>
      withRuntime(async (rt) => {
        const team = await teamOf(rt, opts.org, opts.team)
        await unlinkTeamFromGit(rt.db.db, team.id)
        console.log(`${opts.org}/${opts.team} no longer reports to GitHub`)
      }),
    )
}
