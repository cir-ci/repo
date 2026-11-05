import {
  addMember,
  createOrganization,
  createProjectWithToken,
  createUser,
  generatePassword,
  rotateProjectToken,
  setupCode,
  setUserPassword,
} from '@circi/auth'
import { webhookUrlProblem } from '@circi/core'
import {
  createWebhook,
  deleteWebhook,
  getOrganizationBySlug,
  getProjectBySlugs,
  linkProjectToGithub,
  unlinkProject,
  isWebhookEvent,
  listOrganizations,
  listProjects,
  listWebhooks,
  setOrgAuthSettings,
  WEBHOOK_EVENTS,
} from '@circi/db'
import type { Command } from 'commander'

import type { Runtime } from '../runtime.ts'
import { httpFetcher, runDoctor } from './doctor.ts'
import { printJson, printPassword, printToken, publicProject, withRuntime } from './output.ts'

/** `circi admin user|org|member|project …`, run on the server. */
export function addAdminCommands(program: Command): void {
  const admin = program.command('admin').description('administration commands (run on the server)')
  addUserCommands(admin.command('user').description('manage accounts'))
  addOrgCommands(admin.command('org').description('manage organizations'))
  addMemberCommands(admin.command('member').description('manage organization members'))
  addProjectCommands(admin.command('project').description('manage projects and their CI tokens'))
  addMailCommands(admin.command('mail').description('check outgoing mail'))
  addGithubCommands(admin.command('github').description('link projects to GitHub repositories'))
  admin
    .command('doctor')
    .description('check the deployment for what CirCI cannot enforce (cookie scope of the domains)')
    .action(() =>
      withRuntime(async (rt) => {
        let warned = false
        for (const f of await runDoctor(rt.config, httpFetcher)) {
          console.log(`${f.level === 'ok' ? '✓' : f.level === 'warn' ? '⚠' : '·'} ${f.message}`)
          warned ||= f.level === 'warn'
        }
        if (warned) process.exitCode = 1
      }),
    )
  addAuthCommands(admin.command('auth').description('login methods of an organization'))
  admin
    .command('setup-code')
    .description('print the code that first-run setup in the dashboard asks for')
    .action(() =>
      withRuntime((rt) => {
        console.log(setupCode(rt.config.authSecret))
        return Promise.resolve()
      }),
    )
  addWebhookCommands(admin.command('webhook').description('manage outgoing webhooks of a project'))
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

function addWebhookCommands(webhook: Command): void {
  webhook
    .command('add')
    .description('send signed events of a project to a URL (the secret is printed once)')
    .requiredOption('--org <slug>', 'organization slug')
    .requiredOption('--project <slug>', 'project slug')
    .requiredOption('--url <url>', 'http(s) address that receives POSTs')
    .option('--events <list>', `comma-separated, from: ${WEBHOOK_EVENTS.join(', ')} (default: all)`)
    .option('--json', 'print JSON (includes the secret)')
    .action(
      (opts: { org: string; project: string; url: string; events?: string; json?: boolean }) =>
        withRuntime(async (rt) => {
          const problem = webhookUrlProblem(opts.url, {
            allowPrivate: rt.config.webhookAllowPrivate,
          })
          if (problem) throw new Error(`--url: ${problem}`)
          const url = new URL(opts.url)
          const events = (opts.events?.split(',').map((e) => e.trim()) ?? []).filter(Boolean)
          const unknown = events.filter((e) => !isWebhookEvent(e))
          if (unknown.length > 0) throw new Error(`Unknown event(s): ${unknown.join(', ')}`)
          const project = await projectOf(rt, opts.org, opts.project)
          const created = await createWebhook(rt.db.db, {
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
        await deleteWebhook(rt.db.db, project.id, opts.id)
        console.log('Removed.')
      }),
    )
}

function projectOf(rt: Runtime, org: string, slug: string) {
  return getProjectBySlugs(rt.db.db, { orgSlug: org, projectSlug: slug })
}

function addMailCommands(mail: Command): void {
  mail
    .command('test')
    .description('send a test mail through the configured SMTP server')
    .requiredOption('--to <email>', 'recipient')
    .action((opts: { to: string }) =>
      withRuntime(async (rt) => {
        if (!rt.mailer) throw new Error('SMTP is not configured (set SMTP_HOST and SMTP_FROM)')
        await rt.mailer.send({
          to: opts.to,
          subject: 'CirCI test mail',
          text: 'If you can read this, CirCI can send mail.\n',
        })
        console.log(`Sent a test mail to ${opts.to}`)
      }),
    )
}

function addAuthCommands(auth: Command): void {
  for (const action of ['enable', 'disable'] as const) {
    auth
      .command(`${action} <method>`)
      .description(
        action === 'enable'
          ? 'accept a login method (email or password) in an organization again; the way back in when it was locked down'
          : 'stop accepting a login method (email or password) in an organization',
      )
      .requiredOption('--org <slug>', 'organization slug')
      .action((method: string, opts: { org: string }) =>
        withRuntime(async (rt) => {
          if (method !== 'email' && method !== 'password') {
            throw new Error('method must be "email" or "password"')
          }
          const org = await getOrganizationBySlug(rt.db.db, opts.org)
          const value = action === 'enable'
          // This is the break-glass command, so the lockout guard doesn't apply to it.
          const settings = await setOrgAuthSettings(
            rt.db.db,
            org.id,
            method === 'email' ? { emailLoginEnabled: value } : { passwordLoginEnabled: value },
            {
              force: true,
              instance: {
                password: rt.config.passwordLogin,
                email: rt.config.emailLogin,
                oidc: rt.config.sso.length > 0,
              },
            },
          )
          console.log(
            `${org.slug}: email login ${settings.emailLoginEnabled ? 'on' : 'off'}, password login ${settings.passwordLoginEnabled ? 'on' : 'off'}`,
          )
        }),
      )
  }
}

function addGithubCommands(github: Command): void {
  github
    .command('link')
    .description(
      'report a project’s builds to a GitHub repository (needs the GitHub App installed on it)',
    )
    .requiredOption('--org <slug>', 'organization slug')
    .requiredOption('--project <slug>', 'project slug')
    .requiredOption('--repo <owner/name>', 'the repository')
    .requiredOption('--installation <id>', 'the GitHub App installation id (see its URL on GitHub)')
    .action((opts: { org: string; project: string; repo: string; installation: string }) =>
      withRuntime(async (rt) => {
        if (!rt.config.github) throw new Error('No GitHub App is configured (GITHUB_APP_*)')
        if (!/^[\w.-]+\/[\w.-]+$/.test(opts.repo))
          throw new Error('--repo must look like owner/name')
        if (!/^\d+$/.test(opts.installation)) throw new Error('--installation must be a number')
        const project = await projectOf(rt, opts.org, opts.project)
        await linkProjectToGithub(rt.db.db, project.id, {
          installationId: opts.installation,
          repoRef: opts.repo,
        })
        console.log(`${opts.org}/${opts.project} now reports to ${opts.repo}`)
      }),
    )

  github
    .command('unlink')
    .description('stop reporting a project to GitHub')
    .requiredOption('--org <slug>', 'organization slug')
    .requiredOption('--project <slug>', 'project slug')
    .action((opts: { org: string; project: string }) =>
      withRuntime(async (rt) => {
        const project = await projectOf(rt, opts.org, opts.project)
        await unlinkProject(rt.db.db, project.id)
        console.log(`${opts.org}/${opts.project} no longer reports to GitHub`)
      }),
    )
}
