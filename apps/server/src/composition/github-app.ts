import { GithubApp } from '@circi/providers'

import type { Deps } from '#http/lib/deps.ts'

// The stored App (instance_settings), its replica sync and the address check live in the service
// layer; this file keeps what reads the dashboard's `Deps`.
export {
  GITHUB_APP_TTL_MS,
  githubAppSync,
  publicUrlProblem,
  readStoredGithubApp,
  storeGithubApp,
  useStoredGithubApp,
  type StoredGithubApp,
} from '@circi/services'

export type GithubAppSource = 'env' | 'manifest' | 'none'

type SourceDeps = Pick<Deps.Dashboard, 'githubApp' | 'integrations'>

/** Where the App's credentials came from. `githubApp` is the environment's. */
export function githubAppSource(deps: SourceDeps): GithubAppSource {
  if (deps.githubApp === true) return 'env'
  return deps.integrations?.config.github ? 'manifest' : 'none'
}

/** Whether the instance has a GitHub App now, however it was set up. */
export const githubConfigured = (deps: SourceDeps) => githubAppSource(deps) !== 'none'

/** The GitHub API this instance talks to: the App's, else `GITHUB_API_URL`, else github.com. */
export const githubApiUrl = (deps: Pick<Deps.Dashboard, 'integrations' | 'githubApiUrl'>) =>
  deps.integrations?.config.github?.apiUrl ?? deps.githubApiUrl ?? 'https://api.github.com'

const infos = new WeakMap<object, Promise<{ slug: string; htmlUrl: string } | null>>()

/** The App's slug and public page, asked of GitHub once per configuration (an environment App has no slug configured). */
export function resolveGithubApp(
  deps: Pick<Deps.Dashboard, 'integrations'>,
): Promise<{ slug: string; htmlUrl: string } | null> {
  const config = deps.integrations?.config.github
  if (!config) return Promise.resolve(null)
  let info = infos.get(config)
  if (!info) {
    const app = new GithubApp({
      ...config,
      ...(deps.integrations?.fetch ? { fetch: deps.integrations.fetch } : {}),
    })
    info = app
      .appInfo()
      .then((i) => (i.slug && i.htmlUrl ? { slug: i.slug, htmlUrl: i.htmlUrl } : null))
      .catch(() => null)
    infos.set(config, info)
  }
  return info.then((r) => {
    if (r === null) infos.delete(config)
    return r
  })
}
