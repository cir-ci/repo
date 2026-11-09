import { asRecord } from '@circi/core'

import { createHttpClient, type HttpClient } from '#src/http.ts'
import { trackerError } from '#src/tracker/error.ts'
import type { IssueTracker } from '#src/tracker/tracker.ts'

/**
 * Linear, through its GraphQL API with a personal API key (`Authorization: <key>`, no prefix).
 * GraphQL answers 200 with an `errors` array for most failures, which are reported like an HTTP
 * error here.
 */

export interface LinearTrackerOptions {
  apiKey: string
  /** Default `https://api.linear.app/graphql`. */
  apiUrl?: string
  /** Replaceable in tests. */
  fetch?: typeof fetch
}

interface GraphQlResponse {
  data?: Record<string, unknown>
  errors?: { message?: string; extensions?: { type?: string } }[]
}

const graphQlResponse = (v: unknown): GraphQlResponse => {
  const body = asRecord(v)
  const errors = Array.isArray(body.errors)
    ? body.errors.map((e) => {
        const err = asRecord(e)
        const type = asRecord(err.extensions).type
        return {
          ...(typeof err.message === 'string' ? { message: err.message } : {}),
          ...(typeof type === 'string' ? { extensions: { type } } : {}),
        }
      })
    : undefined
  return { data: asRecord(body.data), ...(errors ? { errors } : {}) }
}

export class LinearTracker implements IssueTracker {
  readonly kind = 'linear'
  readonly #http: HttpClient

  constructor(options: LinearTrackerOptions) {
    this.#http = createHttpClient({
      baseUrl: options.apiUrl ?? 'https://api.linear.app/graphql',
      ...(options.fetch ? { fetch: options.fetch } : {}),
      // Linear has never had a timeout here: keep it so.
      timeoutMs: 0,
      headers: { authorization: options.apiKey },
      fail: ({ status, statusText, data }) =>
        trackerError('Linear', status, graphQlResponse(data).errors?.[0]?.message ?? statusText),
    })
  }

  async #query(query: string, variables: Record<string, unknown> = {}) {
    const { data: answer, statusText } = await this.#http.request('POST', '', {
      body: { query, variables },
    })
    const body = graphQlResponse(answer)
    const message = body.errors?.[0]?.message ?? statusText
    if (body.errors?.length) {
      const authFailure = body.errors[0]?.extensions?.type === 'authentication error'
      throw trackerError('Linear', authFailure ? 401 : 400, message)
    }
    return asRecord(body.data)
  }

  async identify(): Promise<IssueTracker.Account> {
    const data = await this.#query('query { viewer { id organization { id name } } }')
    const org = asRecord(asRecord(data.viewer).organization)
    if (typeof org.id !== 'string') throw trackerError('Linear', 502, 'no workspace in the answer')
    return {
      externalId: org.id,
      name: typeof org.name === 'string' ? org.name : org.id,
    }
  }

  async listTargets(): Promise<IssueTracker.Target[]> {
    const data = await this.#query('query { teams(first: 100) { nodes { id key name } } }')
    const nodes = asRecord(data.teams).nodes
    return (Array.isArray(nodes) ? nodes : []).map((n) => {
      const team = asRecord(n)
      return {
        ref: String(team.id),
        name: `${String(team.name)} (${String(team.key)})`,
      }
    })
  }

  async createIssue(input: IssueTracker.CreateInput): Promise<IssueTracker.Issue> {
    const description = input.imageUrl
      ? `${input.description}\n\n![Diff](${input.imageUrl})`
      : input.description
    const data = await this.#query(
      `mutation($input: IssueCreateInput!) {
        issueCreate(input: $input) { success issue { id identifier url title } }
      }`,
      { input: { teamId: input.target, title: input.title, description } },
    )
    const created = asRecord(data.issueCreate)
    const issue = asRecord(created.issue)
    if (created.success !== true || typeof issue.identifier !== 'string') {
      throw trackerError('Linear', 502, 'the issue was not created')
    }
    if (input.imageUrl && typeof issue.id === 'string') {
      // Best effort: the issue exists and its description already links the image.
      await this.#query(
        `mutation($input: AttachmentCreateInput!) { attachmentCreate(input: $input) { success } }`,
        {
          input: {
            issueId: issue.id,
            title: 'Visual diff',
            url: input.imageUrl,
          },
        },
      ).catch(() => undefined)
    }
    return {
      key: issue.identifier,
      url: String(issue.url),
      title: typeof issue.title === 'string' ? issue.title : input.title,
    }
  }
}
