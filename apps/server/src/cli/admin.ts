import {
  addMember,
  createOrganization,
  createProjectWithToken,
  createUser,
  generatePassword,
  rotateProjectToken,
  setUserPassword,
} from '@circi/auth'
import { listOrganizations, listProjects } from '@circi/db'
import type { Command } from 'commander'

import { printJson, printPassword, printToken, publicProject, withRuntime } from './output.ts'

/** `circi admin user|org|member|project …`, run on the server. */
export function addAdminCommands(program: Command): void {
  const admin = program.command('admin').description('administration commands (run on the server)')
  addUserCommands(admin.command('user').description('manage accounts'))
  addOrgCommands(admin.command('org').description('manage organizations'))
  addMemberCommands(admin.command('member').description('manage organization members'))
  addProjectCommands(admin.command('project').description('manage projects and their CI tokens'))
}

function addUserCommands(user: Command): void {
  user
    .command('create')
    .description('create an account (there is no self sign-up)')
    .requiredOption('--email <email>', 'sign-in email')
    .requiredOption('--name <name>', 'display name')
    .option('--password <password>', 'at least 12 characters (default: generate one and print it)')
    .option('--instance-admin', 'make this person an instance admin')
    .option('--json', 'print JSON (includes a generated password)')
    .action(
      (opts: {
        email: string
        name: string
        password?: string
        instanceAdmin?: boolean
        json?: boolean
      }) =>
        withRuntime(async (rt) => {
          const password = opts.password ?? generatePassword()
          const created = await createUser(rt.auth, {
            email: opts.email,
            name: opts.name,
            password,
            ...(opts.instanceAdmin ? { instanceAdmin: true } : {}),
          })
          const generated = opts.password === undefined
          if (opts.json) {
            return printJson({
              id: created.id,
              email: created.email,
              ...(generated ? { password } : {}),
            })
          }
          console.log(`Created account ${created.email}`)
          if (generated) printPassword(password)
        }),
    )

  user
    .command('set-password')
    .description('set a new password for an account')
    .requiredOption('--email <email>', 'account email')
    .option('--password <password>', 'at least 12 characters (default: generate one and print it)')
    .option('--json', 'print JSON (includes a generated password)')
    .action((opts: { email: string; password?: string; json?: boolean }) =>
      withRuntime(async (rt) => {
        const password = opts.password ?? generatePassword()
        await setUserPassword(rt.auth, rt.db.db, { email: opts.email, password })
        const generated = opts.password === undefined
        if (opts.json) return printJson(generated ? { password } : {})
        console.log(`Changed the password for ${opts.email}`)
        if (generated) printPassword(password)
      }),
    )
}

function addOrgCommands(org: Command): void {
  org
    .command('create')
    .description('create an organization')
    .requiredOption('--name <name>', 'display name, e.g. "Acme Inc"')
    .requiredOption('--owner <email>', 'email of an existing account that will own it')
    .option('--slug <slug>', 'URL name (default: derived from --name)')
    .option('--json', 'print JSON')
    .action((opts: { name: string; owner: string; slug?: string; json?: boolean }) =>
      withRuntime(async (rt) => {
        const created = await createOrganization(rt.auth, rt.db.db, {
          name: opts.name,
          ownerEmail: opts.owner,
          ...(opts.slug ? { slug: opts.slug } : {}),
        })
        if (opts.json) return printJson(created)
        console.log(
          `Created organization "${created.name}" (${created.slug}), owned by ${opts.owner}`,
        )
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

function addMemberCommands(member: Command): void {
  member
    .command('add')
    .description('add an existing account to an organization')
    .requiredOption('--org <slug>', 'organization slug')
    .requiredOption('--email <email>', 'account email')
    .option('--role <role>', 'owner, admin or member', 'member')
    .action((opts: { org: string; email: string; role: string }) =>
      withRuntime(async (rt) => {
        if (opts.role !== 'owner' && opts.role !== 'admin' && opts.role !== 'member') {
          throw new Error(`--role must be owner, admin or member (got "${opts.role}")`)
        }
        await addMember(rt.auth, rt.db.db, {
          orgSlug: opts.org,
          email: opts.email,
          role: opts.role,
        })
        console.log(`Added ${opts.email} to ${opts.org} as ${opts.role}`)
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
          const { project: p, token } = await createProjectWithToken(rt.auth, rt.db.db, {
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
