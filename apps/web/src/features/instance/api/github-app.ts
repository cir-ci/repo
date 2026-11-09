import type { Instance } from '@circi/api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { instancePath } from '#lib/api-paths.ts'
import { getJson, post } from '#lib/http.ts'
import { keys } from '#lib/query-keys.ts'

// ---- Logic (tested in Node) -------------------------------------------------------------------

/** What the Add dialog's GitHub step offers: install now, set the App up, or ask someone who can. */
export type GithubStep = 'install' | 'set-up' | 'ask-admin'

export function githubStep(app: Pick<Instance.GithubApp, 'source' | 'canManage'>): GithubStep {
  if (app.source !== 'none') return 'install'
  return app.canManage ? 'set-up' : 'ask-admin'
}

/** What the instance page says about where the App came from. */
export function githubSourceNote(app: Pick<Instance.GithubApp, 'source'>): string {
  switch (app.source) {
    case 'env':
      return 'Configured by the server’s environment (GITHUB_APP_*). To change it, edit the environment.'
    case 'manifest':
      return 'Created from this page. Its credentials are stored encrypted on this instance.'
    default:
      return 'Not set up yet.'
  }
}

/** The page's `?githubApp=` result, as a sentence; null for nothing to say. */
export function githubAppNote(result: unknown): string | null {
  return result === 'failed'
    ? 'GitHub did not finish creating the App. The link works once, so start again.'
    : null
}

/** Where the browser goes with a form; a seam so tests can watch it instead of leaving the page. */
export const formPost = {
  submit(url: string, fields: Record<string, string>) {
    const form = document.createElement('form')
    form.method = 'post'
    form.action = url
    form.hidden = true
    for (const [name, value] of Object.entries(fields)) {
      const input = document.createElement('input')
      input.type = 'hidden'
      input.name = name
      input.value = value
      form.append(input)
    }
    document.body.append(form)
    form.submit()
  },
}

// ---- Server state -----------------------------------------------------------------------------

export const githubAppQuery = () =>
  queryOptions({
    queryKey: keys.instanceGithubApp(),
    queryFn: () => getJson<Instance.GithubApp>(instancePath('github-app')),
  })

/** Asks for the manifest and posts it to GitHub (the browser leaves this page; GitHub sends it back). */
export function useCreateGithubApp() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name?: string; organization?: string }) => {
      const body = {
        ...(input.name?.trim() ? { name: input.name.trim() } : {}),
        ...(input.organization?.trim() ? { organization: input.organization.trim() } : {}),
      }
      const { manifest, postUrl, state } = await post<Instance.GithubManifest>(
        instancePath('github-app', 'manifest'),
        body,
      )
      formPost.submit(postUrl, { manifest: JSON.stringify(manifest), state })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.instanceGithubApp() }),
  })
}
