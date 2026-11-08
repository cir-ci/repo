import { JiraTracker } from './jira.ts'
import { LinearTracker } from './linear.ts'

/**
 * What every issue tracker adapter (Linear, Jira) offers CirCI: who the credentials belong to,
 * where an issue can go (a Linear team, a Jira project) and creating one. An adapter is built
 * for one set of credentials; nothing outside a tracker's own file knows its API.
 *
 * Failures throw `ProviderApiError` (`revoked` when the credentials no longer work), so callers
 * can answer 502 and store nothing.
 */
export interface IssueTracker {
  /** `integrations.kind` this adapter serves: `linear` or `jira`. */
  readonly kind: string

  /** Who the credentials are: proves they work, and names the account for the Integrations page. */
  identify(): Promise<IssueTracker.Account>

  /** Where an issue can be created: the Linear teams or Jira projects the credentials can see. */
  listTargets(): Promise<IssueTracker.Target[]>

  /** Creates an issue in `target` (a `Target.ref`). A `imageUrl` is linked or attached to it. */
  createIssue(input: IssueTracker.CreateInput): Promise<IssueTracker.Issue>
}

export namespace IssueTracker {
  export interface Account {
    /** The tracker's id for the account (Linear organization id, Jira site host). */
    externalId: string
    /** What a person calls it: the workspace or site name. */
    name: string
  }

  export interface Target {
    /** Linear team id or Jira project key: what `integration_teams.external_ref` holds. */
    ref: string
    name: string
  }

  export interface CreateInput {
    target: string
    title: string
    /** Markdown-ish plain text; the Jira adapter turns it into paragraphs. */
    description: string
    /** Where the diff image can be opened. */
    imageUrl?: string
    /** The kind of issue to file, for a tracker that has them (Jira: `Task`, `Bug`…); others ignore it. */
    issueType?: string
  }

  export interface Issue {
    /** `ENG-123`, `WEB-45`. */
    key: string
    url: string
    title: string
  }

  /** The credentials a tracker kind is built from (the plaintext of `integrations.encrypted_credentials`, as JSON). */
  export type Credentials =
    | { kind: 'linear'; apiKey: string }
    | { kind: 'jira'; siteUrl: string; email: string; apiToken: string }
    | { kind: 'jira'; siteUrl: string; accessToken: string }
}

/** Builds an adapter from stored credentials; undefined for a kind that is not a tracker or unreadable credentials. */
export type TrackerFactory = (kind: string, credentials: string) => IssueTracker | undefined

/** The real adapters. `fetch` is replaceable in tests. */
export function createTrackerFactory(options: { fetch?: typeof fetch } = {}): TrackerFactory {
  const fetchOption = options.fetch ? { fetch: options.fetch } : {}
  return (kind, credentials) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(credentials)
    } catch {
      return undefined
    }
    const c: Record<string, unknown> = typeof parsed === 'object' && parsed ? { ...parsed } : {}
    const text = (key: string) => (typeof c[key] === 'string' ? c[key] : undefined)
    if (kind === 'linear') {
      const apiKey = text('apiKey')
      return apiKey ? new LinearTracker({ apiKey, ...fetchOption }) : undefined
    }
    if (kind === 'jira') {
      const siteUrl = text('siteUrl')
      const email = text('email')
      const apiToken = text('apiToken')
      const accessToken = text('accessToken')
      if (siteUrl && email && apiToken) {
        return new JiraTracker({ siteUrl, email, apiToken, ...fetchOption })
      }
      if (siteUrl && accessToken) return new JiraTracker({ siteUrl, accessToken, ...fetchOption })
    }
    return undefined
  }
}

/** The JSON text to seal for a set of credentials. */
export const serializeCredentials = (credentials: IssueTracker.Credentials): string =>
  JSON.stringify(credentials)
