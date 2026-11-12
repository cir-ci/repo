import { createTransport } from 'nodemailer'

/** Outgoing mail over SMTP (PLAN §7.8). The auth code only sees this small interface. */

export namespace Mailer {
  export interface Mail {
    to: string
    subject: string
    text: string
  }

  export interface SmtpOptions {
    host: string
    port: number
    secure: boolean
    auth?: { user: string; password: string }
    from: string
  }
}

export interface Mailer {
  send(mail: Mailer.Mail): Promise<void>
  /** Connects and logs in to the mail server without sending anything; rejects with the reason. */
  verify?(): Promise<void>
  /** Whether mail can be sent now (a mail server is set up). Absent: always. */
  configured?(): Promise<boolean>
}

/** Thrown by a mailer that has no mail server to send through. */
export class MailNotConfiguredError extends Error {
  constructor() {
    super("Mail isn't set up on this instance")
    this.name = 'MailNotConfiguredError'
  }
}

export function createSmtpMailer(options: Mailer.SmtpOptions): Mailer {
  const transport = createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure,
    ...(options.auth ? { auth: { user: options.auth.user, pass: options.auth.password } } : {}),
    connectionTimeout: 10_000,
    socketTimeout: 20_000,
  })
  return {
    async send(mail) {
      await transport.sendMail({ from: options.from, ...mail })
    },
    async verify() {
      await transport.verify()
    },
  }
}

/**
 * A mailer that reads the mail server's settings at every send, so a change in the dashboard
 * applies to the next mail with no restart. The transport is reused while the settings stay the
 * same. Without settings `send` rejects with `MailNotConfiguredError`.
 */
export function createLiveMailer(current: () => Promise<Mailer.SmtpOptions | undefined>): Mailer {
  let key = ''
  let mailer: Mailer | undefined
  async function resolve(): Promise<Mailer> {
    const options = await current()
    if (!options) throw new MailNotConfiguredError()
    const next = JSON.stringify(options)
    if (next !== key || !mailer) {
      key = next
      mailer = createSmtpMailer(options)
    }
    return mailer
  }
  return {
    async send(mail) {
      await (await resolve()).send(mail)
    },
    async verify() {
      await (await resolve()).verify?.()
    },
    async configured() {
      return (await current()) !== undefined
    },
  }
}

/**
 * The sign-in mail: the code, and a link that opens the sign-in page with the code filled in.
 * The email and code travel in the fragment (`#…`), which browsers never send to a server.
 */
export function signInMail(email: string, code: string, origin: string): Mailer.Mail {
  const link = `${origin}/#signin-email=${encodeURIComponent(email)}&code=${code}`
  return {
    to: email,
    subject: `Your CirCI sign-in code: ${code}`,
    text: [
      `Your CirCI sign-in code is ${code}.`,
      '',
      'It works once and expires in 10 minutes. Or open this link and confirm with one click:',
      link,
      '',
      "If you didn't ask to sign in, you can ignore this email: nobody can sign in without the code.",
      '',
    ].join('\n'),
  }
}

/**
 * The invitation mail. The link opens the sign-in page with the invitation id and address in
 * the fragment; after signing in (an emailed code is enough, even without an account yet) the
 * person confirms joining with one click.
 */
export function invitationMail(input: {
  to: string
  invitationId: string
  workspaceName: string
  inviterName: string
  role: string
  origin: string
}): Mailer.Mail {
  const link = `${input.origin}/#invite=${encodeURIComponent(input.invitationId)}&email=${encodeURIComponent(input.to)}`
  return {
    to: input.to,
    subject: `${input.inviterName} invited you to ${input.workspaceName} on CirCI`,
    text: [
      `${input.inviterName} invited you to join ${input.workspaceName} on CirCI as ${input.role}.`,
      '',
      'The invitation is valid for 7 days. To accept it, open this link and sign in with this email address:',
      link,
      '',
      "If you weren't expecting this, you can ignore this email.",
      '',
    ].join('\n'),
  }
}

/** Tells an account's owner that someone signed in from a browser it hasn't been used from. */
export function newSignInMail(input: {
  to: string
  name: string
  when: Date
  method: string
  userAgent: string | null
  ipAddress: string | null
  origin: string
}): Mailer.Mail {
  return {
    to: input.to,
    subject: 'New sign-in to your CirCI account',
    text: [
      `Hi ${input.name},`,
      '',
      `Someone just signed in to your CirCI account (${input.method}) from a browser we haven't seen before:`,
      '',
      `  When:   ${input.when.toUTCString()}`,
      `  Device: ${input.userAgent ?? 'unknown'}`,
      `  From:   ${input.ipAddress ?? 'unknown address'}`,
      '',
      `If this was you, you don't need to do anything. If not, sign in at ${input.origin}, open "Profile and sessions" to sign that device out, and change your password.`,
      '',
    ].join('\n'),
  }
}

/** Sent to the NEW address: the link that confirms it as the account's email. */
export function confirmNewEmailMail(input: {
  to: string
  name: string
  currentEmail: string
  link: string
}): Mailer.Mail {
  return {
    to: input.to,
    subject: 'Confirm your new CirCI email address',
    text: [
      `Hi ${input.name},`,
      '',
      `You asked to change the email address of your CirCI account from ${input.currentEmail} to this one. Open this link, signed in to CirCI in the same browser, to confirm it:`,
      input.link,
      '',
      'The link works for one hour. Until you open it, nothing changes.',
      '',
      "If you didn't ask for this, you can ignore this email.",
      '',
    ].join('\n'),
  }
}

/** Sent to the OLD address when a change is requested: nothing has changed yet. */
export function emailChangeRequestedMail(input: {
  to: string
  name: string
  newEmail: string
  origin: string
}): Mailer.Mail {
  return {
    to: input.to,
    subject: 'Someone asked to change your CirCI email address',
    text: [
      `Hi ${input.name},`,
      '',
      `A change of your CirCI account's email address to ${input.newEmail} was requested. It only takes effect once that address is confirmed, and your account keeps using this address until then.`,
      '',
      `If this wasn't you, sign in at ${input.origin}, open "Profile and sessions" to sign other devices out, and change your password.`,
      '',
    ].join('\n'),
  }
}
