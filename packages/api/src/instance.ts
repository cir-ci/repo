export namespace Instance {
  export interface AuthMethods {
    password: boolean
    email: boolean
    sso: { id: string; name: string }[]
  }

  export interface Notices {
    publicUrlChange: { from: string; to: string; at: string; checklist: string[] } | null
  }

  /** `GET /api/instance/github-app`: the instance's GitHub App; no secret is ever in it. */
  export interface GithubApp {
    /** Where its credentials come from: `GITHUB_APP_*` (env), the one-click flow (manifest), or nowhere. */
    source: 'env' | 'manifest' | 'none'
    /** The viewer is an instance admin and may create the App. */
    canManage: boolean
    appId: string | null
    /** Null when it cannot be resolved (an env App GitHub did not answer for). */
    slug: string | null
    /** The App's public page on GitHub. */
    htmlUrl: string | null
    /** Why GitHub could not reach this instance's webhook (a non-public address), else null. */
    warning: string | null
    /** Why the App cannot be created from this address, else null. */
    blocked: string | null
    /** The App's name to suggest. */
    defaultName: string
  }

  /** `POST /api/instance/github-app/manifest`: a form to post to GitHub. */
  export interface GithubManifest {
    manifest: Record<string, unknown>
    postUrl: string
    state: string
  }
}
