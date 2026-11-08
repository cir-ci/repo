import type { SlackMessage } from './slack-messages.ts'

/**
 * A client for the parts of Slack's Web API CirCI uses: the OAuth v2 install (`oauth.v2.access`),
 * `auth.test`, `conversations.list` (channels the bot can see) and `chat.postMessage`. Slack
 * answers HTTP 200 with `{ ok: false, error }` for most failures, so the client turns those into
 * `SlackApiError`. `revoked` is set when the workspace took the token away (`invalid_auth`,
 * `token_revoked`, `account_inactive`): retrying cannot help and a person has to reinstall.
 *
 * The bot token is passed per call; the client holds no credentials, so one instance serves every
 * workspace. `fetch` and the API address are injectable for tests.
 */

export const SLACK_API_URL = 'https://slack.com/api'

/** What CirCI asks the workspace for: post in channels, and list them to pick one. */
export const SLACK_BOT_SCOPES = ['chat:write', 'chat:write.public', 'channels:read', 'groups:read']

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown) => (typeof v === 'string' ? v : '')

const REVOKED_ERRORS = new Set(['invalid_auth', 'token_revoked', 'account_inactive'])

export class SlackApiError extends Error {
  /** Slack's error code (`channel_not_found`, `ratelimited`…), or `http_<status>`. */
  readonly code: string
  readonly status: number
  readonly revoked: boolean
  /** Seconds Slack asked to wait, for `ratelimited`. */
  readonly retryAfter: number | undefined
  constructor(code: string, status: number, retryAfter?: number) {
    super(`Slack: ${code}`)
    this.name = 'SlackApiError'
    this.code = code
    this.status = status
    this.revoked = REVOKED_ERRORS.has(code)
    this.retryAfter = retryAfter
  }
}

export const isSlackRevoked = (err: unknown): err is SlackApiError =>
  err instanceof SlackApiError && err.revoked

export namespace SlackClient {
  export interface Options {
    apiUrl?: string
    fetch?: typeof fetch
  }

  export interface Channel {
    id: string
    name: string
    private: boolean
  }

  export interface Installation {
    teamId: string
    teamName: string
    botToken: string
    botUserId: string | null
  }

  export interface Identity {
    teamId: string
    team: string
    botUserId: string | null
  }

  export interface Post extends Pick<SlackMessage.Message, 'text' | 'blocks'> {
    channel: string
  }
}

export class SlackClient {
  readonly #apiUrl: string
  readonly #fetch: typeof fetch

  constructor(options: SlackClient.Options = {}) {
    this.#apiUrl = (options.apiUrl ?? SLACK_API_URL).replace(/\/$/, '')
    this.#fetch = options.fetch ?? fetch
  }

  async #call(
    method: string,
    init: { token?: string; json?: unknown; form?: Record<string, string> },
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {}
    let body: string | undefined
    if (init.token) headers.authorization = `Bearer ${init.token}`
    if (init.json !== undefined) {
      headers['content-type'] = 'application/json; charset=utf-8'
      body = JSON.stringify(init.json)
    } else if (init.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded'
      body = new URLSearchParams(init.form).toString()
    }
    const res = await this.#fetch(`${this.#apiUrl}/${method}`, {
      method: 'POST',
      headers,
      ...(body === undefined ? {} : { body }),
    })
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after'))
      throw new SlackApiError('ratelimited', 429, Number.isFinite(wait) ? wait : undefined)
    }
    if (!res.ok) throw new SlackApiError(`http_${res.status}`, res.status)
    const parsed: unknown = await res.json()
    const data = isRecord(parsed) ? parsed : {}
    if (data.ok !== true) {
      throw new SlackApiError(
        typeof data.error === 'string' ? data.error : 'unknown_error',
        res.status,
      )
    }
    return data
  }

  /** The address to send someone to for installing the app; `state` comes back on the callback. */
  authorizeUrl(input: { clientId: string; redirectUri: string; state: string }): string {
    const url = new URL('https://slack.com/oauth/v2/authorize')
    url.searchParams.set('client_id', input.clientId)
    url.searchParams.set('scope', SLACK_BOT_SCOPES.join(','))
    url.searchParams.set('redirect_uri', input.redirectUri)
    url.searchParams.set('state', input.state)
    return url.toString()
  }

  /** Trades the temporary code from the redirect for the workspace's bot token (`oauth.v2.access`). */
  async exchangeCode(input: {
    clientId: string
    clientSecret: string
    code: string
    redirectUri: string
  }): Promise<SlackClient.Installation> {
    const data = await this.#call('oauth.v2.access', {
      form: {
        client_id: input.clientId,
        client_secret: input.clientSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
      },
    })
    const team = isRecord(data.team) ? data.team : undefined
    const botToken = data.access_token
    if (typeof botToken !== 'string' || typeof team?.id !== 'string') {
      throw new SlackApiError('malformed_response', 200)
    }
    return {
      teamId: team.id,
      teamName: typeof team.name === 'string' && team.name ? team.name : team.id,
      botToken,
      botUserId: typeof data.bot_user_id === 'string' ? data.bot_user_id : null,
    }
  }

  /** Whether the token still works, and whose it is (`auth.test`). */
  async authTest(token: string): Promise<SlackClient.Identity> {
    const data = await this.#call('auth.test', { token })
    return {
      teamId: text(data.team_id),
      team: text(data.team),
      botUserId: typeof data.user_id === 'string' ? data.user_id : null,
    }
  }

  /** The public and private channels the bot can see, archived ones left out, by name. */
  async listChannels(token: string): Promise<SlackClient.Channel[]> {
    const channels: SlackClient.Channel[] = []
    let cursor = ''
    // Slack pages at most 1000 channels; a workspace has to be huge to need more than a few pages.
    for (let page = 0; page < 20; page++) {
      // eslint-disable-next-line no-await-in-loop -- each page names the next one
      const data = await this.#call('conversations.list', {
        token,
        form: {
          types: 'public_channel,private_channel',
          exclude_archived: 'true',
          limit: '200',
          ...(cursor ? { cursor } : {}),
        },
      })
      const found: unknown[] = Array.isArray(data.channels) ? data.channels : []
      for (const c of found.filter(isRecord)) {
        if (typeof c.id === 'string' && typeof c.name === 'string') {
          channels.push({
            id: c.id,
            name: c.name,
            private: c.is_private === true,
          })
        }
      }
      const next = isRecord(data.response_metadata) ? data.response_metadata.next_cursor : undefined
      cursor = typeof next === 'string' ? next : ''
      if (!cursor) break
    }
    return channels.toSorted((a, b) => a.name.localeCompare(b.name))
  }

  /** Posts a message (`chat.postMessage`); returns its timestamp. */
  async postMessage(token: string, post: SlackClient.Post): Promise<string> {
    const data = await this.#call('chat.postMessage', {
      token,
      json: {
        channel: post.channel,
        text: post.text,
        blocks: post.blocks,
        unfurl_links: false,
        unfurl_media: false,
      },
    })
    return text(data.ts)
  }
}
