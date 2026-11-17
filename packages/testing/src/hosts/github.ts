import { createHmac } from 'node:crypto'

import { fakeHost, jsonResponse as json } from './types.ts'

/** The `x-hub-signature-256` value GitHub sends for `body`, signed with the webhook `secret`. */
export const githubSignature = (secret: string, body: string): string =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

/**
 * A stateful fake of GitHub's HTTP edge: just the endpoints the adapter uses, with the behaviour
 * the adapter depends on (ids, 404 for a deleted comment, 404 for an uninstalled installation).
 * Different from the scripted fake in github.test.ts, which pins exact requests.
 */
export function fakeGithubHost(options: {
  installationId: string
  repos: string[]
  /** The App's id (what `performed_via_github_app` carries on its comments). */
  appId?: string
}) {
  const appId = Number(options.appId ?? '4242')
  let nextId = 100
  const checks = new Set<number>()
  let comments: {
    id: number
    body: string
    user: { type: string; login: string }
    performed_via_github_app: { id: number } | null
  }[] = []
  const outputs = new Map<number, unknown>()
  let revoked = false
  const artifacts: { id: number; runId: string; name: string; zip: Buffer; expired: boolean }[] = []
  /** Whether a request for the signed artifact address carried an `authorization` header. */
  const signedWithAuth: boolean[] = []

  const behaviour: typeof fetch = async (input, init) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    const path = url.pathname
    const body: unknown = req.body ? JSON.parse(await req.text()) : undefined

    if (
      req.method === 'POST' &&
      path === `/app/installations/${options.installationId}/access_tokens`
    ) {
      return revoked
        ? json({ message: 'Not Found' }, 404)
        : json({
            token: 'ghs_fake',
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
          })
    }
    if (req.method === 'POST' && path.endsWith('/check-runs')) {
      const id = nextId++
      checks.add(id)
      return json({ id }, 201)
    }
    const check = /\/check-runs\/(\d+)$/.exec(path)
    if (req.method === 'PATCH' && check) {
      const id = Number(check[1])
      const output = Reflect.get(Object(body), 'output')
      if (output !== undefined) outputs.set(id, output)
      return checks.has(id) ? json({ id }) : json({ message: 'Not Found' }, 404)
    }
    if (req.method === 'GET' && /\/issues\/\d+\/comments$/.test(path)) {
      const per = Number(url.searchParams.get('per_page') ?? '30')
      const page = Number(url.searchParams.get('page') ?? '1')
      return json(comments.slice((page - 1) * per, page * per))
    }
    if (req.method === 'POST' && /\/issues\/\d+\/comments$/.test(path)) {
      const comment = {
        id: nextId++,
        body: String(Reflect.get(Object(body), 'body')),
        user: { type: 'Bot', login: 'circi[bot]' },
        performed_via_github_app: { id: appId },
      }
      comments.push(comment)
      return json(comment, 201)
    }
    const comment = /\/issues\/comments\/(\d+)$/.exec(path)
    if (req.method === 'PATCH' && comment) {
      const found = comments.find((c) => c.id === Number(comment[1]))
      if (!found) return json({ message: 'Not Found' }, 404)
      // A person's comment is theirs to edit, never the App's.
      if (found.user.type !== 'Bot') return json({ message: 'Forbidden' }, 403)
      found.body = String(Reflect.get(Object(body), 'body'))
      return json(found)
    }
    const runArtifacts = /\/actions\/runs\/(\d+)\/artifacts$/.exec(path)
    if (req.method === 'GET' && runArtifacts) {
      const list = artifacts.filter((a) => a.runId === runArtifacts[1])
      return json({
        total_count: list.length,
        artifacts: list.map((a) => ({
          id: a.id,
          name: a.name,
          size_in_bytes: a.zip.length,
          expired: a.expired,
        })),
      })
    }
    const zipOf = /\/actions\/artifacts\/(\d+)\/zip$/.exec(path)
    if (req.method === 'GET' && zipOf) {
      const found = artifacts.find((a) => a.id === Number(zipOf[1]))
      if (!found) return json({ message: 'Not Found' }, 404)
      // GitHub redirects to a signed address on another host.
      return new Response(null, {
        status: 302,
        headers: { location: `https://pipelines.signed.test/artifact/${found.id}?sig=abc` },
      })
    }
    const signed = /^\/artifact\/(\d+)$/.exec(path)
    if (req.method === 'GET' && url.host === 'pipelines.signed.test' && signed) {
      signedWithAuth.push(req.headers.has('authorization'))
      const found = artifacts.find((a) => a.id === Number(signed[1]))
      return found
        ? new Response(new Uint8Array(found.zip), {
            headers: { 'content-length': String(found.zip.length) },
          })
        : json({ message: 'Not Found' }, 404)
    }
    if (req.method === 'GET' && path === '/installation/repositories') {
      return json({
        total_count: options.repos.length,
        repositories: options.repos.map((full_name) => ({
          full_name,
          private: full_name.endsWith('-private'),
        })),
      })
    }
    return json({ message: `unhandled ${req.method} ${path}` }, 500)
  }

  return {
    ...fakeHost(behaviour),
    host: {
      statusCount: () => checks.size,
      comments: () => comments.map((c) => c.body),
      deleteComments: () => {
        comments = []
      },
      /** A comment a person wrote (it may quote the marker). */
      seedHumanComment: (body: string) => {
        comments.push({
          id: nextId++,
          body,
          user: { type: 'User', login: 'ann' },
          performed_via_github_app: null,
        })
      },
      checkOutput: (id: number | string) => outputs.get(Number(id)),
      revoke: () => {
        revoked = true
      },
      /** An artifact of a workflow run: `zip` is what `actions/upload-artifact` stored. */
      addArtifact: (
        runId: string | number,
        artifact: { name: string; zip: Buffer; expired?: boolean },
      ) => {
        const id = nextId++
        artifacts.push({
          id,
          runId: String(runId),
          name: artifact.name,
          zip: artifact.zip,
          expired: artifact.expired ?? false,
        })
        return id
      },
      /** For each download from the signed address, whether the request carried a token. */
      signedDownloadsHadAuth: () => [...signedWithAuth],
    },
    sign: (secret: string, body: string) => ({
      'x-hub-signature-256': githubSignature(secret, body),
    }),
  }
}

/**
 * GitHub as far as verifying installations goes: access-token requests for `known` installations
 * succeed, for `gone` ones answer 404 (uninstalled), for any other 502 (GitHub is down); the
 * installation's repository list has `acme/web`. `asked()` lists the installations asked for.
 */
export function fakeGithubInstallationsHost(options: { known: string[]; gone: string[] }) {
  const asked: string[] = []
  const behaviour: typeof fetch = async (input, init) => {
    const url = new URL(new Request(input, init).url)
    const token = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(url.pathname)
    if (token) {
      const id = token[1] ?? ''
      asked.push(id)
      if (options.known.includes(id)) {
        return json(
          { token: 'ghs_x', expires_at: new Date(Date.now() + 3_600_000).toISOString() },
          201,
        )
      }
      if (options.gone.includes(id)) return json({ message: 'Not Found' }, 404)
      return json({ message: 'Bad gateway' }, 502)
    }
    if (url.pathname === '/installation/repositories') {
      return json({ repositories: [{ full_name: 'acme/web' }] })
    }
    return json({ message: 'unscripted' }, 500)
  }
  return { ...fakeHost(behaviour), asked: () => [...asked] }
}

export namespace recordingGithub {
  export interface CheckCall {
    installationId: string
    repo: string
    input: {
      sha: string
      detailsUrl: string
      existingId?: string
      report: { conclusion?: string; actions: unknown[] }
    }
  }
  export interface CommentCall {
    installationId: string
    repo: string
    pr: number
    body: string
    existing?: string
  }
}

/**
 * A GitHub at the provider level, not the HTTP one: records what `upsertCheckRun` and
 * `upsertComment` were asked to send, and answers with fixed ids.
 */
export function recordingGithub() {
  const checks: recordingGithub.CheckCall[] = []
  const comments: recordingGithub.CommentCall[] = []
  return {
    checks,
    comments,
    github: {
      async upsertCheckRun(
        installationId: string,
        repo: string,
        input: recordingGithub.CheckCall['input'],
      ) {
        checks.push({ installationId, repo, input })
        return '9001'
      },
      async upsertComment(
        installationId: string,
        repo: string,
        pr: number,
        body: string,
        existing?: string,
      ) {
        comments.push({ installationId, repo, pr, body, ...(existing ? { existing } : {}) })
        return '7001'
      },
    },
  }
}
