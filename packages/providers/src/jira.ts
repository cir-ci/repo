import { trackerError } from './tracker-error.ts'
import type { IssueTracker } from './tracker.ts'

/**
 * Jira Cloud, through REST v3: an account email with an API token (basic auth) or an OAuth
 * access token (bearer; `siteUrl` is then the `https://api.atlassian.com/ex/jira/<cloudId>` base
 * and `browseUrl` the site's address). Issues are `Task`s with an Atlassian Document Format
 * description. The diff image is linked in the description: the attachments endpoint needs the
 * bytes, which sit behind CirCI's sign-in.
 */

export type JiraTrackerOptions = {
  /** `https://acme.atlassian.net`. */
  siteUrl: string
  /** Where people open issues, when `siteUrl` is an API gateway address. Default: `siteUrl`. */
  browseUrl?: string
  issueType?: string
  /** Replaceable in tests. */
  fetch?: typeof fetch
} & ({ email: string; apiToken: string } | { accessToken: string })

const trimSlash = (s: string) => s.replace(/\/+$/, '')

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? { ...v } : {}

const adfParagraph = (line: string) => {
  const content = line
    .split(/(https?:\/\/\S+)/)
    .filter((p) => p !== '')
    .map((p) =>
      /^https?:\/\//.test(p)
        ? { type: 'text', text: p, marks: [{ type: 'link', attrs: { href: p } }] }
        : { type: 'text', text: p },
    )
  return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }
}

/** Plain text as ADF: a paragraph per block, a link mark on bare URLs. */
export function toAdf(text: string, imageUrl?: string) {
  const blocks = text.split(/\n{2,}/).map((b) => b.replace(/\n/g, ' \n').trim())
  const lines = imageUrl ? [...blocks, `Diff: ${imageUrl}`] : blocks
  return { type: 'doc', version: 1, content: lines.map(adfParagraph) }
}

export class JiraTracker implements IssueTracker {
  readonly kind = 'jira'
  readonly #options: JiraTrackerOptions

  constructor(options: JiraTrackerOptions) {
    this.#options = options
  }

  #headers() {
    const o = this.#options
    const authorization =
      'accessToken' in o
        ? `Bearer ${o.accessToken}`
        : `Basic ${Buffer.from(`${o.email}:${o.apiToken}`).toString('base64')}`
    return {
      authorization,
      accept: 'application/json',
      'content-type': 'application/json',
    }
  }

  async #call(method: string, path: string, body?: unknown): Promise<unknown> {
    const doFetch = this.#options.fetch ?? fetch
    const res = await doFetch(`${trimSlash(this.#options.siteUrl)}/rest/api/3${path}`, {
      method,
      headers: this.#headers(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const payload: unknown = await res.json().catch(() => undefined)
    if (!res.ok) {
      const messages = asRecord(payload).errorMessages
      const detail = Array.isArray(messages) ? messages.join('; ') : res.statusText
      throw trackerError('Jira', res.status, detail)
    }
    return payload
  }

  async identify(): Promise<IssueTracker.Account> {
    await this.#call('GET', '/myself')
    const host = new URL(this.#options.browseUrl ?? this.#options.siteUrl).host
    return { externalId: host, name: host }
  }

  async listTargets(): Promise<IssueTracker.Target[]> {
    const projects = await this.#call('GET', '/project')
    return (Array.isArray(projects) ? projects : []).map((p) => {
      const project = asRecord(p)
      return {
        ref: String(project.key),
        name: `${String(project.name)} (${String(project.key)})`,
      }
    })
  }

  async createIssue(input: IssueTracker.CreateInput): Promise<IssueTracker.Issue> {
    const created = asRecord(
      await this.#call('POST', '/issue', {
        fields: {
          project: { key: input.target },
          summary: input.title,
          issuetype: { name: this.#options.issueType ?? 'Task' },
          description: toAdf(input.description, input.imageUrl),
        },
      }),
    )
    if (typeof created.key !== 'string')
      throw trackerError('Jira', 502, 'no issue key in the answer')
    const site = trimSlash(this.#options.browseUrl ?? this.#options.siteUrl)
    return {
      key: created.key,
      url: `${site}/browse/${created.key}`,
      title: input.title,
    }
  }
}
