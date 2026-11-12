import type { InstanceLimitKey, WorkspaceCreation } from '@circi/core'
import { isRecord } from '@circi/core'
import { openSecret, sealSecret } from '@circi/core/node'
import type { Database } from '@circi/db'
import { getSetting, INSTANCE_GENERAL_KEY } from '@circi/db/queries'
import { deleteSetting, setSetting } from '@circi/db/repositories'

import { emptyStored, type InstanceConfig } from './model.ts'

/**
 * What the dashboard saved, in `instance_settings`: one key per group, so saving one never
 * rewrites another. Secrets (the mail password, Slack's and the providers' client secrets) are
 * sealed with the instance secret, as the GitHub App's private key is, and never leave this file
 * in the clear except to the code that needs to use them.
 */

const GENERAL = INSTANCE_GENERAL_KEY
const SMTP = 'instance.smtp'
const SLACK = 'instance.slack'
const SSO = 'instance.sso'

const str = (o: Record<string, unknown>, k: string): string | undefined => {
  const v = o[k]
  return typeof v === 'string' && v !== '' ? v : undefined
}
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)

function parse(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined
  try {
    const value: unknown = JSON.parse(raw)
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

function secretsOf(authSecret: string, sealed: string | undefined): Record<string, unknown> {
  const opened = sealed ? openSecret(authSecret, sealed) : undefined
  return opened ? (parse(opened) ?? {}) : {}
}

const LIMIT_KEYS: InstanceLimitKey[] = [
  'defaultProjectRetentionDays',
  'gcGraceHours',
  'uploadTimeoutMinutes',
  'jobRetentionDays',
  'staticSitesMaxMb',
  'webhookTimeoutSeconds',
]

function readGeneral(raw: string | undefined, into: InstanceConfig.Stored) {
  const general = parse(raw)
  if (!general) return
  const creation = general.workspaceCreation
  if (creation === 'admin' || creation === 'anyone') into.workspaceCreation = creation
  const signIn = isRecord(general.signIn) ? general.signIn : {}
  for (const key of ['password', 'email', 'sso'] as const) {
    const v = bool(signIn[key])
    if (v !== undefined) into.signIn[key] = v
  }
  const limits = isRecord(general.limits) ? general.limits : {}
  for (const key of LIMIT_KEYS) {
    const v = limits[key]
    if (typeof v === 'number' && Number.isFinite(v)) into.limits[key] = v
  }
}

function readSmtp(authSecret: string, raw: string | undefined): InstanceConfig.Smtp | undefined {
  const o = parse(raw)
  const host = o && str(o, 'host')
  const from = o && str(o, 'from')
  if (!o || !host || !from) return undefined
  const port = typeof o.port === 'number' ? o.port : 587
  const user = str(o, 'user')
  const password = str(secretsOf(authSecret, str(o, 'sealed')), 'password')
  return {
    host,
    port,
    secure: o.secure === true,
    from,
    ...(user && password ? { auth: { user, password } } : {}),
  }
}

function readSlack(authSecret: string, raw: string | undefined): InstanceConfig.Slack | undefined {
  const o = parse(raw)
  const clientId = o && str(o, 'clientId')
  const clientSecret = o && str(secretsOf(authSecret, str(o, 'sealed')), 'clientSecret')
  return clientId && clientSecret ? { clientId, clientSecret } : undefined
}

function readSso(authSecret: string, raw: string | undefined): InstanceConfig.Sso[] {
  const o = parse(raw)
  if (!o || !Array.isArray(o.providers)) return []
  const secrets = secretsOf(authSecret, str(o, 'sealed'))
  const out: InstanceConfig.Sso[] = []
  const list: unknown[] = o.providers
  for (const p of list) {
    if (!isRecord(p)) continue
    const id = p.id
    const clientId = str(p, 'clientId')
    const clientSecret = typeof id === 'string' ? str(secrets, id) : undefined
    if (
      (id === 'github' || id === 'gitlab' || id === 'google' || id === 'oidc') &&
      clientId &&
      clientSecret
    ) {
      const issuer = str(p, 'issuer')
      out.push({
        id,
        name: str(p, 'name') ?? id,
        clientId,
        clientSecret,
        ...(issuer ? { issuer } : {}),
        trustedForEmail: p.trustedForEmail === true,
      })
    }
  }
  return out
}

/** Everything saved, with secrets opened. Unreadable parts are as if never saved. */
export async function readStored(db: Database, authSecret: string): Promise<InstanceConfig.Stored> {
  const [general, smtp, slack, sso] = await Promise.all([
    getSetting(db, GENERAL),
    getSetting(db, SMTP),
    getSetting(db, SLACK),
    getSetting(db, SSO),
  ])
  const stored = emptyStored()
  readGeneral(general, stored)
  const smtpValue = readSmtp(authSecret, smtp)
  if (smtpValue) stored.smtp = smtpValue
  const slackValue = readSlack(authSecret, slack)
  if (slackValue) stored.slack = slackValue
  stored.sso = readSso(authSecret, sso)
  return stored
}

/** Writes every group of `next` in one transaction (a group is rewritten whole; an empty one is deleted). */
export async function writeStored(
  db: Database,
  authSecret: string,
  next: InstanceConfig.Stored,
): Promise<void> {
  await db.transaction(async (tx) => {
    const general: {
      workspaceCreation?: WorkspaceCreation
      signIn: InstanceConfig.Stored['signIn']
      limits: InstanceConfig.Stored['limits']
    } = {
      ...(next.workspaceCreation ? { workspaceCreation: next.workspaceCreation } : {}),
      signIn: next.signIn,
      limits: next.limits,
    }
    await setSetting(tx, GENERAL, JSON.stringify(general))
    if (next.smtp) {
      const { host, port, secure, from, auth } = next.smtp
      await setSetting(
        tx,
        SMTP,
        JSON.stringify({
          host,
          port,
          secure,
          from,
          ...(auth
            ? {
                user: auth.user,
                sealed: sealSecret(authSecret, JSON.stringify({ password: auth.password })),
              }
            : {}),
        }),
      )
    } else await deleteSetting(tx, SMTP)
    if (next.slack) {
      await setSetting(
        tx,
        SLACK,
        JSON.stringify({
          clientId: next.slack.clientId,
          sealed: sealSecret(authSecret, JSON.stringify({ clientSecret: next.slack.clientSecret })),
        }),
      )
    } else await deleteSetting(tx, SLACK)
    if (next.sso.length > 0) {
      await setSetting(
        tx,
        SSO,
        JSON.stringify({
          providers: next.sso.map((p) => ({
            id: p.id,
            name: p.name,
            clientId: p.clientId,
            ...(p.issuer ? { issuer: p.issuer } : {}),
            trustedForEmail: p.trustedForEmail,
          })),
          sealed: sealSecret(
            authSecret,
            JSON.stringify(Object.fromEntries(next.sso.map((p) => [p.id, p.clientSecret]))),
          ),
        }),
      )
    } else await deleteSetting(tx, SSO)
  })
}
