import { asRecord } from '@circi/core'

import { createHttpClient, type HttpClient } from './http.ts'
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

/**
 * A Jira Cloud site's address as its origin, or undefined when it is not an https address of a
 * named host (an IP, `localhost` or a bare name could aim the server at its own network).
 */
export function normalizeJiraSite(raw: string): string | undefined {
  const text = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return undefined
  }
  const host = url.hostname
  const named = host.includes('.') && !/^[\d.]+$/.test(host) && !host.includes(':')
  if (url.protocol !== 'https:' || !named || host === 'localhost' || host.endsWith('.local')) {
    return undefined
  }
  return url.origin
}

const trimSlash = (s: string) => s.replace(/\/+$/, '')

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
  readonly #http: HttpClient

  constructor(options: JiraTrackerOptions) {
    this.#options = options
    const authorization =
      'accessToken' in options
        ? `Bearer ${options.accessToken}`
        : `Basic ${Buffer.from(`${options.email}:${options.apiToken}`).toString('base64')}`
    this.#http = createHttpClient({
      baseUrl: `${trimSlash(options.siteUrl)}/rest/api/3`,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      // Jira has never had a timeout here: keep it so.
      timeoutMs: 0,
      headers: { authorization, accept: 'application/json' },
      fail: ({ status, statusText, data }) => {
        const messages = asRecord(data).errorMessages
        return trackerError(
          'Jira',
          status,
          Array.isArray(messages) ? messages.join('; ') : statusText,
        )
      },
    })
  }

  async #call(method: string, path: string, body?: unknown): Promise<unknown> {
    const { data } = await this.#http.request(method, path, body === undefined ? {} : { body })
    return data
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
          issuetype: { name: input.issueType || this.#options.issueType || 'Task' },
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
