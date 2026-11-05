import { createTransport } from 'nodemailer'

/** Outgoing mail over SMTP (PLAN §7.8). The auth code only sees this small interface. */

export interface Mail {
  to: string
  subject: string
  text: string
}

export interface Mailer {
  send(mail: Mail): Promise<void>
}

export interface SmtpOptions {
  host: string
  port: number
  secure: boolean
  auth?: { user: string; password: string }
  from: string
}

export function createSmtpMailer(options: SmtpOptions): Mailer {
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
  }
}

/**
 * The sign-in mail: the code, and a link that opens the sign-in page with the code filled in.
 * The email and code travel in the fragment (`#…`), which browsers never send to a server.
 */
export function signInMail(email: string, code: string, origin: string): Mail {
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
  organizationName: string
  inviterName: string
  role: string
  origin: string
}): Mail {
  const link = `${input.origin}/#invite=${encodeURIComponent(input.invitationId)}&email=${encodeURIComponent(input.to)}`
  return {
    to: input.to,
    subject: `${input.inviterName} invited you to ${input.organizationName} on CirCI`,
    text: [
      `${input.inviterName} invited you to join ${input.organizationName} on CirCI as ${input.role}.`,
      '',
      'Open this link and sign in with this email address to accept (the invitation is valid for 7 days):',
      link,
      '',
      "If you weren't expecting this, you can ignore this email.",
      '',
    ].join('\n'),
  }
}
