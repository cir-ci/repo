import type { CheckReport } from './render.ts'

/**
 * What every git host adapter (GitHub, GitLab, Bitbucket…) offers CirCI. Consumers (the notify
 * job, the webhook routes, the repository picker) resolve an adapter from the registry by the
 * connection's `kind` and call only this; nothing outside a provider's own file knows a host's API.
 *
 * `externalId` is `provider_connections.external_id`: the host's id for the connection (the GitHub
 * App installation id). A token-based host reads its credentials for that connection itself, from
 * what it was constructed with, so the arguments stay the same for every host.
 *
 * Per-connection secrets: a token host whose credentials differ per connection gets them as the
 * optional trailing `credentials` argument, the opened plaintext of `provider_connections.
 * encrypted_credentials` (the notify job opens it with `openSecret`, so adapters never see the
 * instance secret). GitHub ignores it. Passing it beats a registry that returns a provider bound
 * to the connection: the registry and every existing call site stay as they are.
 */
export interface GitProvider {
  /** `provider_connections.kind` this adapter serves, e.g. `github`. */
  readonly kind: string

  /**
   * Shows a build's state on its commit or pull request (GitHub: a check run; other hosts: a
   * commit status): creates it, or updates `existingId`. Returns its id, to be passed back next
   * time. Throws `ProviderApiError`, with `revoked` set when the host says the connection is gone.
   */
  upsertCheckRun(
    externalId: string,
    repo: string,
    input: GitProvider.StatusInput,
    credentials?: string,
  ): Promise<string>

  /**
   * Writes the one summary comment on a pull or merge request: edits `existingId`, else finds the
   * comment carrying `PR_COMMENT_MARKER`, else creates it. Returns the comment's id.
   */
  upsertComment(
    externalId: string,
    repo: string,
    prNumber: number,
    body: string,
    existingId?: string,
    credentials?: string,
  ): Promise<string>

  /** Whether a webhook delivery really came from the host: checks its signature or token. */
  verifyWebhook(rawBody: Buffer | string, headers: GitProvider.WebhookHeaders): boolean

  /** The repositories the connection can see, for choosing one per project. */
  listRepositories(externalId: string, credentials?: string): Promise<GitProvider.Repository[]>
}

export namespace GitProvider {
  export interface StatusInput {
    sha: string
    report: CheckReport
    detailsUrl: string
    existingId?: string
  }

  export interface Repository {
    /** `owner/name`. */
    ref: string
    private: boolean
  }

  export type WebhookHeaders = Readonly<Record<string, string | string[] | undefined>>
}

/** The first value of a header, whatever the casing the caller's framework used. */
export function headerValue(headers: GitProvider.WebhookHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()] ?? headers[name]
  return Array.isArray(value) ? value[0] : value
}

/**
 * A failed call to a git host. `revoked` means the connection itself is gone (uninstalled,
 * suspended, token revoked): retrying cannot help, so callers record that it needs attention.
 */
export class ProviderApiError extends Error {
  readonly status: number
  readonly revoked: boolean
  constructor(status: number, message: string, options: { revoked?: boolean } = {}) {
    super(message)
    this.name = 'ProviderApiError'
    this.status = status
    this.revoked = options.revoked ?? false
  }
}

export const isConnectionRevoked = (err: unknown): err is ProviderApiError =>
  err instanceof ProviderApiError && err.revoked

/** Adapters by `provider_connections.kind`. */
export interface ProviderRegistry<P = GitProvider> {
  get(kind: string): P | undefined
  kinds(): string[]
}

/** A registry over the given adapters (entries that are undefined, such as an unconfigured host, are skipped). */
export function providerRegistry<P>(
  entries: Readonly<Record<string, P | undefined>>,
): ProviderRegistry<P> {
  const present = Object.entries(entries).flatMap(([kind, p]) =>
    p === undefined ? [] : [[kind, p] as const],
  )
  const byKind = new Map(present)
  return { get: (kind) => byKind.get(kind), kinds: () => [...byKind.keys()] }
}
