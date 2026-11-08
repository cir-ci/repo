import {
  addMember,
  createWorkspace,
  createTeamWithToken,
  createUser,
  generatePassword,
  rotateTeamToken,
  setupCode,
  setUserPassword,
} from '@circi/auth'
import { webhookUrlProblem } from '@circi/core'
import {
  createWebhook,
  deleteWebhook,
  getWorkspaceBySlug,
  getTeamBySlugs,
  addIgnoreRegion,
  listIgnoreRegions,
  removeIgnoreRegion,
  isWebhookEvent,
  listWorkspaces,
  listTeams,
  listWebhooks,
  setWorkspaceAuthSettings,
  storageUsage,
  WEBHOOK_EVENTS,
} from '@circi/db'
import {
  linkTeamToGithub,
  migrateStorage,
  previewRetention,
  runRetention,
  unlinkTeamFromGit,
} from '@circi/services'
import { createStorage } from '@circi/storage'
import type { Command } from 'commander'

import { formatFinding, httpFetcher, runDoctor } from '#lifecycle/doctor.ts'
import type { Runtime } from '#lifecycle/runtime.ts'

import { printJson, printPassword, printToken, publicTeam, withRuntime } from './output.ts'

/** `circi admin user|workspace|member|team …`, run on the server. */
export function addAdminCommands(program: Command): void {
  const admin = program.command('admin').description('administration commands (run on the server)')
  addUserCommands(admin.command('user').description('manage accounts'))
  addWorkspaceCommands(admin.command('workspace').description('manage workspaces'))
  addMemberCommands(admin.command('member').description('manage workspace members'))
  addTeamCommands(admin.command('team').description('manage teams and their CI tokens'))
  addMailCommands(admin.command('mail').description('check outgoing mail'))
  addGithubCommands(admin.command('github').description('link teams to GitHub repositories'))
  admin
    .command('doctor')
    .description('check the deployment for what CirCI cannot enforce (cookie scope of the domains)')
    .action(() =>
      withRuntime(async (rt) => {
        let warned = false
        for (const f of await runDoctor(rt.config, httpFetcher, rt.storage)) {
          console.log(formatFinding(f))
          warned ||= f.level === 'warn'
        }
        if (warned) process.exitCode = 1
      }),
    )
  addIgnoreCommands(
    admin.command('ignore').description('regions to ignore when comparing screenshots'),
  )
  addStorageCommands(admin.command('storage').description('what is stored, and cleaning up'))
  addAuthCommands(admin.command('auth').description('login methods of a workspace'))
  admin
    .command('setup-code')
    .description('print the code that first-run setup in the dashboard asks for')
    .action(() =>
      withRuntime((rt) => {
        console.log(setupCode(rt.config.authSecret))
        return Promise.resolve()
      }),
    )
  addWebhookCommands(admin.command('webhook').description('manage outgoing webhooks of a team'))
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

function addWorkspaceCommands(workspace: Command): void {
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

function addMemberCommands(member: Command): void {
  member
    .command('add')
    .description('add an existing account to a workspace')
    .requiredOption('--org <slug>', 'organization slug')
    .requiredOption('--email <email>', 'account email')
    .option('--role <role>', 'owner, admin or member', 'member')
    .action((opts: { org: string; email: string; role: string }) =>
      withRuntime(async (rt) => {
        if (opts.role !== 'owner' && opts.role !== 'admin' && opts.role !== 'member') {
          throw new Error(`--role must be owner, admin or member (got "${opts.role}")`)
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

function addTeamCommands(team: Command): void {
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

function addWebhookCommands(webhook: Command): void {
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
        const created = await createWebhook(rt.db.db, {
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
        await deleteWebhook(rt.db.db, team.id, opts.id)
        console.log('Removed.')
      }),
    )
}

function teamOf(rt: Runtime, workspace: string, slug: string) {
  return getTeamBySlugs(rt.db.db, { workspaceSlug: workspace, teamSlug: slug })
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
          ? 'accept a login method (email or password) in a workspace again; the way back in when it was locked down'
          : 'stop accepting a login method (email or password) in a workspace',
      )
      .requiredOption('--org <slug>', 'organization slug')
      .action((method: string, opts: { org: string }) =>
        withRuntime(async (rt) => {
          if (method !== 'email' && method !== 'password') {
            throw new Error('method must be "email" or "password"')
          }
          const workspace = await getWorkspaceBySlug(rt.db.db, opts.org)
          const value = action === 'enable'
          // This is the break-glass command, so the lockout guard doesn't apply to it.
          const settings = await setWorkspaceAuthSettings(
            rt.db.db,
            workspace.id,
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
            `${workspace.slug}: email login ${settings.emailLoginEnabled ? 'on' : 'off'}, password login ${settings.passwordLoginEnabled ? 'on' : 'off'}`,
          )
        }),
      )
  }
}

function addGithubCommands(github: Command): void {
  github
    .command('link')
    .description(
      'report a team’s builds to a GitHub repository (needs the GitHub App installed on it)',
    )
    .requiredOption('--org <slug>', 'organization slug')
    .requiredOption('--team <slug>', 'team slug')
    .requiredOption('--repo <owner/name>', 'the repository')
    .requiredOption('--installation <id>', 'the GitHub App installation id (see its URL on GitHub)')
    .action((opts: { org: string; team: string; repo: string; installation: string }) =>
      withRuntime(async (rt) => {
        if (!rt.config.github) throw new Error('No GitHub App is configured (GITHUB_APP_*)')
        if (!/^[\w.-]+\/[\w.-]+$/.test(opts.repo))
          throw new Error('--repo must look like owner/name')
        if (!/^\d+$/.test(opts.installation)) throw new Error('--installation must be a number')
        const team = await teamOf(rt, opts.org, opts.team)
        await linkTeamToGithub(rt.db.db, team.id, {
          installationId: opts.installation,
          repoRef: opts.repo,
        })
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

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

function addStorageCommands(storage: Command): void {
  storage
    .command('usage')
    .description('how much is stored, by kind, and how much is waiting to be deleted')
    .option('--json', 'print JSON')
    .action((opts: { json?: boolean }) =>
      withRuntime(async (rt) => {
        const usage = await storageUsage(rt.db.db)
        if (opts.json) return printJson(usage)
        for (const f of usage.files)
          console.log(`${f.kind.padEnd(10)} ${String(f.count).padStart(7)} files  ${mb(f.bytes)}`)
        console.log(`${'total'.padEnd(10)} ${mb(usage.totalBytes)}`)
        console.log(
          `waiting to be deleted: ${usage.markedForDeletion.count} files, ${mb(usage.markedForDeletion.bytes)} (after the ${rt.config.gcGraceHours} h grace period)`,
        )
      }),
    )

  storage
    .command('migrate')
    .description(
      'copy every stored file to another storage (local disk or S3), under the same keys',
    )
    .requiredOption('--to <driver>', 'fs or s3')
    .option('--path <dir>', 'for fs: the target directory')
    .option('--bucket <name>', 'for s3: the target bucket')
    .option('--region <region>', 'for s3: its region')
    .option('--endpoint <url>', 'for s3: a custom endpoint (R2, MinIO…)')
    .option('--force-path-style', 'for s3: use path-style addressing (MinIO)')
    .action(
      (opts: {
        to: string
        path?: string
        bucket?: string
        region?: string
        endpoint?: string
        forcePathStyle?: boolean
      }) =>
        withRuntime(async (rt) => {
          const target =
            opts.to === 'fs'
              ? opts.path
                ? createStorage({ driver: 'fs', path: opts.path })
                : undefined
              : opts.to === 's3' && opts.bucket
                ? createStorage({
                    driver: 's3',
                    bucket: opts.bucket,
                    region: opts.region ?? 'us-east-1',
                    ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
                    ...(opts.forcePathStyle ? { forcePathStyle: true } : {}),
                    ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
                      ? {
                          credentials: {
                            accessKeyId: process.env.S3_ACCESS_KEY_ID,
                            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
                          },
                        }
                      : {}),
                  })
                : undefined
          if (!target) throw new Error('Use --to fs --path <dir>, or --to s3 --bucket <name>')
          await target.healthCheck()
          const result = await migrateStorage(rt.db.db, {
            from: rt.storage,
            to: target,
            onFile: (n) => {
              if (n % 100 === 0) console.log(`  ${n} files…`)
            },
          })
          console.log(
            `Copied ${result.copied}, already there ${result.skipped}, missing at the source ${result.missing.length}, failed ${result.failed.length}.`,
          )
          for (const f of result.failed.slice(0, 10))
            console.log(`  failed ${f.sha256}: ${f.error}`)
          if (result.failed.length > 0) process.exitCode = 1
          else console.log(`Now set STORAGE_DRIVER=${opts.to} (and its settings) and restart.`)
        }),
    )

  storage
    .command('gc')
    .description('run retention now: expire old builds and sites, delete files nothing uses')
    .option(
      '--grace-hours <hours>',
      'how long unused files wait before deletion (default: GC_GRACE_HOURS)',
    )
    .option(
      '--dry-run',
      'list what would be deleted (count, bytes, sample of keys); change nothing',
    )
    .action((opts: { graceHours?: string; dryRun?: boolean }) =>
      withRuntime(async (rt) => {
        const grace =
          opts.graceHours === undefined ? rt.config.gcGraceHours : Number(opts.graceHours)
        if (!Number.isFinite(grace) || grace < 0) throw new Error('--grace-hours must be 0 or more')
        if (opts.dryRun) {
          const preview = await previewRetention(rt.db.db, { graceMs: grace * 3600_000 })
          const { count, bytes, sampleKeys } = preview.wouldDelete
          console.log(`Dry run: nothing is deleted or marked.`)
          console.log(
            `Would delete ${count} files, ${mb(bytes)} (unused and marked for over ${grace} h).`,
          )
          for (const key of sampleKeys) console.log(`  ${key}`)
          if (count > sampleKeys.length) console.log(`  … and ${count - sampleKeys.length} more`)
          console.log(
            `${preview.wouldMark} more unused files would be marked now and deleted after the grace period. Builds and sites past retention are not simulated.`,
          )
          return
        }
        const result = await runRetention(rt.db.db, {
          graceMs: grace * 3600_000,
          deleteObject: (key) => rt.storage.delete(key),
        })
        console.log(JSON.stringify(result, null, 2))
      }),
    )
}

function addIgnoreCommands(ignore: Command): void {
  ignore
    .command('add')
    .description('ignore a rectangle (pixels from the top left) in the screenshots with this name')
    .requiredOption('--org <slug>', 'organization slug')
    .requiredOption('--team <slug>', 'team slug')
    .requiredOption('--name <name>', 'the screenshot name, as shown in the build')
    .requiredOption('--region <x,y,width,height>', 'the rectangle')
    .action((opts: { org: string; team: string; name: string; region: string }) =>
      withRuntime(async (rt) => {
        const [x, y, width, height] = opts.region.split(',').map((n) => Number(n.trim()))
        if ([x, y, width, height].some((n) => n === undefined || Number.isNaN(n))) {
          throw new Error('--region must look like 10,20,300,40')
        }
        const team = await teamOf(rt, opts.org, opts.team)
        const added = await addIgnoreRegion(rt.db.db, team.id, {
          name: opts.name,
          x: x ?? 0,
          y: y ?? 0,
          width: width ?? 0,
          height: height ?? 0,
        })
        console.log(
          `Added ${added.id}: ${added.name} ${added.x},${added.y} ${added.width}x${added.height}`,
        )
        console.log('It applies to builds processed from now on (use /circi rerun to redo one).')
      }),
    )

  ignore
    .command('list')
    .description('list a team’s ignored regions')
    .requiredOption('--org <slug>', 'organization slug')
    .requiredOption('--team <slug>', 'team slug')
    .action((opts: { org: string; team: string }) =>
      withRuntime(async (rt) => {
        const team = await teamOf(rt, opts.org, opts.team)
        for (const r of await listIgnoreRegions(rt.db.db, team.id)) {
          console.log(`${r.id}  ${r.name}  ${r.x},${r.y} ${r.width}x${r.height}`)
        }
      }),
    )

  ignore
    .command('remove <id>')
    .description('stop ignoring a region')
    .requiredOption('--org <slug>', 'organization slug')
    .requiredOption('--team <slug>', 'team slug')
    .action((id: string, opts: { org: string; team: string }) =>
      withRuntime(async (rt) => {
        const team = await teamOf(rt, opts.org, opts.team)
        await removeIgnoreRegion(rt.db.db, team.id, id)
        console.log('Removed.')
      }),
    )
}
