import {
  createOrganization,
  createProject,
  listOrganizations,
  listProjects,
  rotateProjectToken,
} from '@circi/db'
import type { Command } from 'commander'

import { printJson, printToken, publicProject, withRuntime } from './output.ts'

/** `circi admin org …` and `circi admin project …`, run on the server. */
export function addAdminCommands(program: Command): void {
  const admin = program.command('admin').description('administration commands (run on the server)')
  addOrgCommands(admin.command('org').description('manage organizations'))
  addProjectCommands(admin.command('project').description('manage projects and their CI tokens'))
}

function addOrgCommands(org: Command): void {
  org
    .command('create')
    .description('create an organization')
    .requiredOption('--name <name>', 'display name, e.g. "Acme Inc"')
    .option('--slug <slug>', 'URL name (default: derived from --name)')
    .option('--json', 'print JSON')
    .action((opts: { name: string; slug?: string; json?: boolean }) =>
      withRuntime(async (rt) => {
        const created = await createOrganization(rt.db.db, {
          name: opts.name,
          ...(opts.slug ? { slug: opts.slug } : {}),
        })
        if (opts.json) return printJson(created)
        console.log(`Created organization "${created.name}" (${created.slug})`)
      }),
    )

  org
    .command('list')
    .description('list organizations')
    .option('--json', 'print JSON')
    .action((opts: { json?: boolean }) =>
      withRuntime(async (rt) => {
        const orgs = await listOrganizations(rt.db.db)
        if (opts.json) return printJson(orgs)
        if (orgs.length === 0) return console.log('No organizations yet.')
        for (const o of orgs) console.log(`${o.slug}\t${o.name}`)
      }),
    )
}

function addProjectCommands(project: Command): void {
  project
    .command('create')
    .description('create a project and print its CI token')
    .requiredOption('--org <slug>', 'organization slug')
    .requiredOption('--name <name>', 'display name, e.g. "Web app"')
    .option('--slug <slug>', 'URL name (default: derived from --name)')
    .option('--default-branch <branch>', 'branch whose builds become baselines', 'main')
    .option('--json', 'print JSON (includes the token)')
    .action(
      (opts: { org: string; name: string; slug?: string; defaultBranch: string; json?: boolean }) =>
        withRuntime(async (rt) => {
          const { project: p, token } = await createProject(rt.db.db, {
            orgSlug: opts.org,
            name: opts.name,
            defaultBranch: opts.defaultBranch,
            ...(opts.slug ? { slug: opts.slug } : {}),
          })
          if (opts.json) return printJson({ project: publicProject(p), token })
          console.log(`Created project ${opts.org}/${p.slug} (default branch: ${p.defaultBranch})`)
          printToken(token)
        }),
    )

  project
    .command('list')
    .description("list an organization's projects")
    .requiredOption('--org <slug>', 'organization slug')
    .option('--json', 'print JSON')
    .action((opts: { org: string; json?: boolean }) =>
      withRuntime(async (rt) => {
        const projects = await listProjects(rt.db.db, opts.org)
        if (opts.json) return printJson(projects.map(publicProject))
        if (projects.length === 0) return console.log(`No projects in ${opts.org} yet.`)
        for (const p of projects) {
          console.log(`${p.slug}\t${p.name}\tbranch=${p.defaultBranch}\ttoken=${p.tokenHint}`)
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
        const { project: p, token } = await rotateProjectToken(rt.db.db, {
          orgSlug: opts.org,
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
