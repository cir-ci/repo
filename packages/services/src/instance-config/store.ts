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

/** The sealed secrets, opened; `undefined` when they can't be (another instance secret, or damage). */
function secretsOf(
  authSecret: string,
  sealed: string | undefined,
): Record<string, unknown> | undefined {
  const opened = sealed ? openSecret(authSecret, sealed) : undefined
  return opened ? parse(opened) : undefined
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

function readSmtp(
  authSecret: string,
  raw: string | undefined,
): { value: InstanceConfig.Smtp; unreadable: boolean } | undefined {
  const o = parse(raw)
  const host = o && str(o, 'host')
  const from = o && str(o, 'from')
  if (!o || !host || !from) return undefined
  const port = typeof o.port === 'number' ? o.port : 587
  const user = str(o, 'user')
  const sealed = str(o, 'sealed')
  const opened = sealed ? secretsOf(authSecret, sealed) : undefined
  const unreadable = sealed !== undefined && opened === undefined
  const password = unreadable ? '' : str(opened ?? {}, 'password')
  return {
    unreadable,
    value: {
      host,
      port,
      secure: o.secure === true,
      from,
      ...(user && password !== undefined ? { auth: { user, password } } : {}),
    },
  }
}

function readSlack(
  authSecret: string,
  raw: string | undefined,
): { value: InstanceConfig.Slack; unreadable: boolean } | undefined {
  const o = parse(raw)
  const clientId = o && str(o, 'clientId')
  if (!o || !clientId) return undefined
  const sealed = str(o, 'sealed')
  const opened = sealed ? secretsOf(authSecret, sealed) : undefined
  const clientSecret = opened && str(opened, 'clientSecret')
  if (clientSecret) return { value: { clientId, clientSecret }, unreadable: false }
  return sealed ? { value: { clientId, clientSecret: '' }, unreadable: true } : undefined
}

const SSO_IDS = ['github', 'gitlab', 'google', 'oidc'] as const

function readSso(
  authSecret: string,
  raw: string | undefined,
): { providers: InstanceConfig.Sso[]; unreadable: Record<string, string> } {
  const o = parse(raw)
  const providers: InstanceConfig.Sso[] = []
  const unreadable: Record<string, string> = {}
  if (!o || !Array.isArray(o.providers)) return { providers, unreadable }
  const list: unknown[] = o.providers
  for (const p of list) {
    if (!isRecord(p)) continue
    const id = SSO_IDS.find((known) => known === p.id)
    const clientId = str(p, 'clientId')
    const sealed = str(p, 'sealed')
    if (!id || !clientId || !sealed) continue
    const clientSecret = str(secretsOf(authSecret, sealed) ?? {}, 'clientSecret')
    // A secret that can't be opened keeps its sealed text, so a save of another provider writes it back as it was.
    if (!clientSecret) unreadable[id] = sealed
    const issuer = str(p, 'issuer')
    providers.push({
      id,
      name: str(p, 'name') ?? id,
      clientId,
      clientSecret: clientSecret ?? '',
      ...(issuer ? { issuer } : {}),
      trustedForEmail: p.trustedForEmail === true,
    })
  }
  return { providers, unreadable }
}

/**
 * Everything saved, with secrets opened. A secret that can't be opened (the instance secret was
 * rotated) is flagged in `unreadable` and its group is kept, never treated as absent.
 */
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
  if (smtpValue) {
    stored.smtp = smtpValue.value
    stored.unreadable.smtp = smtpValue.unreadable
  }
  const slackValue = readSlack(authSecret, slack)
  if (slackValue) {
    stored.slack = slackValue.value
    stored.unreadable.slack = slackValue.unreadable
  }
  const ssoValue = readSso(authSecret, sso)
  stored.sso = ssoValue.providers
  stored.unreadable.sso = ssoValue.unreadable
  return stored
}

export type Group = 'general' | 'smtp' | 'slack' | 'sso'

/**
 * Writes one group of `next` (rewritten whole; an empty one is deleted), and no other, so saving
 * one group can never revert or damage another. Call it with the settings locked
 * (`lockInstanceSettings`) in the same transaction as the read.
 */
export async function writeGroup(
  tx: Database,
  authSecret: string,
  next: InstanceConfig.Stored,
  group: Group,
): Promise<void> {
  if (group === 'general') {
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
  } else if (group === 'smtp') {
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
  } else if (group === 'slack') {
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
  } else if (next.sso.length > 0) {
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
          // Each provider has its own sealed secret; one that can't be opened is written back as it was.
          sealed:
            next.unreadable.sso[p.id] ??
            sealSecret(authSecret, JSON.stringify({ clientSecret: p.clientSecret })),
        })),
      }),
    )
  } else await deleteSetting(tx, SSO)
}
