import type { Database } from '@circi/db'

import type { Mailer } from './mail.ts'
import type { SsoProvider } from './plugins/sso/sso.ts'

export interface AuthOptions {
  db: Database
  /** BETTER_AUTH_SECRET: signs sessions and cookies. */
  secret: string
  /** The dashboard origin (PUBLIC_URL); auth lives under `${baseURL}/api/auth`. */
  baseURL: string
  /**
   * Sends the email sign-in codes. Without it the email-code endpoints exist but send nothing;
   * the server only exposes them when email login is switched on.
   */
  mailer?: Mailer
  /**
   * Email + password sign-in is on (default). Off: only email codes and single sign-on work. A
   * function is asked at every sign-in request, so the setting can change while running.
   */
  passwordLogin?: boolean | (() => boolean | Promise<boolean>)
  /**
   * Single sign-on providers the operator set up. None: sign-in is password and email only.
   * These are the providers at start; `auth.reloadSso` replaces them while running.
   */
  sso?: SsoProvider[]
  /**
   * Called at the start of every request to better-auth: brings settings that can change while
   * running (the providers, the password switch) up to date, e.g. through `auth.reloadSso`.
   */
  refresh?: () => Promise<void>
  /**
   * Rate limiting of the sign-in endpoints, per client address. Default: on in production, off
   * otherwise (better-auth's own default). Tests that exercise the limiter switch it on.
   */
  rateLimit?: boolean
  /** Called when sending a mail fails (it's never awaited, so sign-in timing doesn't leak). */
  onMailError?: (err: unknown) => void
}

/** What the plugins need: the schema generator builds them with none of it. */
export type PluginOptions = Partial<
  Pick<AuthOptions, 'db' | 'mailer' | 'onMailError' | 'baseURL' | 'sso'>
>
