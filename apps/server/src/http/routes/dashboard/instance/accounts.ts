import type { InstanceAdmin } from '@circi/api'
import {
  createUser,
  fromNodeHeaders,
  generatePassword,
  MIN_PASSWORD_LENGTH,
  sendSignInCode,
  setInstanceAdmin,
  setUserEmail,
  setUserPassword,
} from '@circi/auth'
import { ValidationError } from '@circi/core'
import { ConflictError, NotFoundError } from '@circi/db'
import { countInstanceAdmins, getAccount, isInstanceAdmin, listAccounts } from '@circi/db/queries'
import { changeAccountEmail } from '@circi/services'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { requireInstanceAdmin } from '#http/hooks/instance-admin.ts'
import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'

const listQuery = z.object({
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})
const createBody = z.object({
  email: z.email().max(254),
  name: z.string().trim().min(1).max(100),
  instanceAdmin: z.boolean().optional(),
  /** Omitted: CirCI generates one and returns it once (unless `signInCode`). */
  password: z.string().min(MIN_PASSWORD_LENGTH).max(128).optional(),
  /** No password at all: mail the person a one-time sign-in code and link instead. */
  signInCode: z.boolean().optional(),
})
const resetBody = z.object({ password: z.string().min(MIN_PASSWORD_LENGTH).max(128).optional() })
const patchBody = z.object({ instanceAdmin: z.boolean() })
const banBody = z.object({
  reason: z.string().trim().max(500).optional(),
  /** Days until the ban ends; omitted is permanent. */
  expiresInDays: z.number().int().min(1).max(3650).optional(),
})
const emailBody = z.object({ email: z.string().trim().min(1).max(254) })
const idParams = z.object({ id: z.string().min(1) })

const wire = (a: listAccounts.Item): InstanceAdmin.Account => ({
  ...a,
  banExpires: a.banExpires?.toISOString() ?? null,
  createdAt: a.createdAt.toISOString(),
  lastSignInAt: a.lastSignInAt?.toISOString() ?? null,
})

/**
 * `/api/instance/accounts…`: accounts of the whole instance, for instance admins. Reads are
 * CirCI's own queries; every change goes through better-auth's admin API (hashing, bans,
 * sessions), called as the signed-in admin.
 */
export const dashboardInstanceAccountRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  app.addHook('onRequest', requireInstanceAdmin(deps.db))

  async function load(id: string): Promise<listAccounts.Item> {
    const account = await getAccount(deps.db, id)
    if (!account) throw new NotFoundError('No such account')
    return account
  }

  app.get('/instance/accounts', async (req): Promise<InstanceAdmin.AccountList> => {
    const q = parse(listQuery, req.query)
    const { accounts, total } = await listAccounts(deps.db, {
      ...(q.q ? { search: q.q } : {}),
      page: q.page,
      pageSize: q.pageSize,
    })
    return { accounts: accounts.map(wire), total, page: q.page, pageSize: q.pageSize }
  })

  /**
   * An account with a password: the one given, else a generated one that is returned once. Or,
   * with `signInCode` (when the instance has mail), one without any password that is mailed a
   * one-time sign-in code, the same code "Email me a code" sends.
   */
  app.post('/instance/accounts', async (req, reply) => {
    const body = parse(createBody, req.body)
    if (body.signInCode) {
      if (body.password) throw new ValidationError('Give a password or a sign-in code, not both')
      if (!deps.instance?.mailer || deps.emailLogin !== true) {
        throw new ConflictError("Email sign-in isn't set up on this instance (it needs SMTP)")
      }
      const created = await createUser(deps.auth, {
        email: body.email,
        name: body.name,
        ...(body.instanceAdmin ? { instanceAdmin: true } : {}),
      })
      await sendSignInCode(deps.auth, created.email)
      const result: InstanceAdmin.CreatedAccount = {
        account: wire(await load(created.id)),
        password: null,
        signInCodeSentTo: created.email,
      }
      return reply.code(201).send(result)
    }
    const password = body.password ?? generatePassword()
    const created = await createUser(deps.auth, {
      email: body.email,
      name: body.name,
      password,
      ...(body.instanceAdmin ? { instanceAdmin: true } : {}),
    })
    const result: InstanceAdmin.CreatedAccount = {
      account: wire(await load(created.id)),
      password: body.password ? null : password,
    }
    return reply.code(201).send(result)
  })

  app.patch('/instance/accounts/:id', async (req) => {
    const { id } = parse(idParams, req.params)
    const { instanceAdmin } = parse(patchBody, req.body)
    const account = await load(id)
    if (account.instanceAdmin && !instanceAdmin && (await countInstanceAdmins(deps.db)) <= 1) {
      throw new ConflictError('This is the last instance admin: make someone else one first')
    }
    await setInstanceAdmin(deps.auth, {
      userId: id,
      instanceAdmin,
      headers: fromNodeHeaders(req.headers),
    })
    return { account: wire(await load(id)) }
  })

  /**
   * Sets the address directly, with no confirmation mail: for instances without mail, or a
   * mailbox the person can't reach. The service checks the policy and that the address is free.
   */
  app.post('/instance/accounts/:id/email', async (req): Promise<InstanceAdmin.EmailChanged> => {
    const { id } = parse(idParams, req.params)
    const { email } = parse(emailBody, req.body)
    const { previousEmail } = await changeAccountEmail(deps.db, {
      actor: { instanceAdmin: await isInstanceAdmin(deps.db, currentUser(req).id) },
      userId: id,
      email,
      apply: (next) =>
        setUserEmail(deps.auth, {
          userId: id,
          email: next,
          headers: fromNodeHeaders(req.headers),
        }),
    })
    return { account: wire(await load(id)), previousEmail }
  })

  /** The new password is in this response only; every session of the account is revoked. */
  app.post(
    '/instance/accounts/:id/reset-password',
    async (req): Promise<InstanceAdmin.PasswordReset> => {
      const { id } = parse(idParams, req.params)
      const body = parse(resetBody, req.body ?? {})
      const account = await load(id)
      const password = body.password ?? generatePassword()
      await setUserPassword(deps.auth, deps.db, { email: account.email, password })
      await deps.auth.api.revokeUserSessions({
        body: { userId: id },
        headers: fromNodeHeaders(req.headers),
      })
      return { password }
    },
  )

  app.post('/instance/accounts/:id/ban', async (req) => {
    const { id } = parse(idParams, req.params)
    const body = parse(banBody, req.body ?? {})
    if (id === currentUser(req).id) throw new ConflictError("You can't ban yourself")
    await load(id)
    await deps.auth.api.banUser({
      body: {
        userId: id,
        ...(body.reason ? { banReason: body.reason } : {}),
        ...(body.expiresInDays ? { banExpiresIn: body.expiresInDays * 24 * 60 * 60 } : {}),
      },
      headers: fromNodeHeaders(req.headers),
    })
    return { account: wire(await load(id)) }
  })

  app.post('/instance/accounts/:id/unban', async (req) => {
    const { id } = parse(idParams, req.params)
    await load(id)
    await deps.auth.api.unbanUser({ body: { userId: id }, headers: fromNodeHeaders(req.headers) })
    return { account: wire(await load(id)) }
  })

  app.post('/instance/accounts/:id/sign-out', async (req, reply) => {
    const { id } = parse(idParams, req.params)
    await load(id)
    await deps.auth.api.revokeUserSessions({
      body: { userId: id },
      headers: fromNodeHeaders(req.headers),
    })
    return reply.code(204).send()
  })
}
