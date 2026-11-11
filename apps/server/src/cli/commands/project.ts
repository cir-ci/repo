import { createProjectWithToken, rotateProjectToken } from '@circi/auth'
import { listProjects } from '@circi/db/queries'
import type { Command } from 'commander'

import { printJson, printToken, publicProject, withRuntime } from '#cli/lib/output.ts'

/** `circi admin project create|list|rotate-token` */
export function addProjectCommands(admin: Command): void {
  const project = admin.command('project').description('manage projects and their CI tokens')

  project
    .command('create')
    .description('create a project and print its CI token')
    .requiredOption('--org <slug>', 'organization slug')
    .requiredOption('--name <name>', 'display name, e.g. "Web app"')
    .option('--slug <slug>', 'URL name (default: derived from --name)')
    .option('--default-branch <branch>', 'branch whose builds become baselines', 'main')
    .option(
      '--member <email>',
      'add this workspace member to the project (repeatable; owners and admins see every project anyway)',
      (email: string, all: string[]) => [...all, email],
      [],
    )
    .option('--json', 'print JSON (includes the token)')
    .action(
      (opts: {
        org: string
        name: string
        slug?: string
        defaultBranch: string
        member: string[]
        json?: boolean
      }) =>
        withRuntime(async (rt) => {
          const { project: p, token } = await createProjectWithToken(rt.auth, rt.db.db, {
            workspaceSlug: opts.org,
            name: opts.name,
            defaultBranch: opts.defaultBranch,
            ...(opts.slug ? { slug: opts.slug } : {}),
            ...(opts.member.length > 0 ? { memberEmails: opts.member } : {}),
          })
          if (opts.json) return printJson({ project: publicProject(p), token })
          console.log(`Created project ${opts.org}/${p.slug} (default branch: ${p.defaultBranch})`)
          printToken(token)
        }),
    )

  project
    .command('list')
    .description("list a workspace's projects")
    .requiredOption('--org <slug>', 'organization slug')
    .option('--json', 'print JSON')
    .action((opts: { org: string; json?: boolean }) =>
      withRuntime(async (rt) => {
        const projects = await listProjects(rt.db.db, opts.org)
        if (opts.json) return printJson(projects.map(publicProject))
        if (projects.length === 0) return console.log(`No projects in ${opts.org} yet.`)
        for (const p of projects) {
          const token = p.ciKeyId ? 'token set' : 'no token (run rotate-token)'
          console.log(`${p.slug}\t${p.name}\tbranch=${p.defaultBranch}\t${token}`)
        }
      }),
    )

  project
    .command('rotate-token')
    .description('replace a project CI token (the old one stops working immediately)')
    .requiredOption('--org <slug>', 'organization slug')
    .requiredOption('--project <slug>', 'project slug')
    .option('--json', 'print JSON (includes the token)')
    .action((opts: { org: string; project: string; json?: boolean }) =>
      withRuntime(async (rt) => {
        const { project: p, token } = await rotateProjectToken(rt.auth, rt.db.db, {
          workspaceSlug: opts.org,
          projectSlug: opts.project,
        })
        if (opts.json) return printJson({ project: publicProject(p), token })
        console.log(
          `Rotated the CI token for ${opts.org}/${p.slug}. The old token no longer works.`,
        )
        printToken(token)
      }),
    )
}
