import { describe, expect, it } from 'vitest'

import { isConnectionRevoked, type GitProvider } from '#src/git/provider.ts'
import { type CheckReport, PR_COMMENT_MARKER } from '#src/git/render.ts'

/**
 * The contract every git host adapter keeps. A provider's test file builds a harness (the adapter
 * pointed at a fake of the host's HTTP edge) and runs `runGitProviderContract`; the same
 * behaviours then hold for GitHub, GitLab, Bitbucket…
 */
export interface ProviderHarness {
  provider: GitProvider
  externalId: string
  /** A repository the fake host knows. */
  repo: string
  prNumber: number
  /** Repositories the connection can see on the fake host. */
  repositories: string[]
  host: {
    /** How many statuses (check runs) exist on the fake host. */
    statusCount(): number
    /** Bodies of the comments on the pull request, oldest first. */
    comments(): string[]
    /** Deletes every comment, as a person might. */
    deleteComments(): void
    /** Makes the host answer that the connection is gone. */
    revoke(): void
  }
  /** Headers a delivery with this body carries when the host signed it correctly. */
  signed(body: string): GitProvider.WebhookHeaders
  /** The host sends a shared token, not a signature of the body (GitLab): a changed body cannot be told apart. */
  tokenOnly?: boolean
}

const report: CheckReport = {
  name: 'CirCI / default',
  status: 'completed',
  conclusion: 'action_required',
  title: '3 changed: review required',
  summary: 'details',
  actions: [
    {
      identifier: 'approve',
      label: 'Approve',
      description: 'Accept these changes',
    },
  ],
}

const commentBody = (n: number) => `${PR_COMMENT_MARKER}\nbuild ${n}`

export function runGitProviderContract(name: string, make: () => ProviderHarness): void {
  describe(`${name}: GitProvider contract`, () => {
    it('shows a build on its commit once, then updates the same status', async () => {
      const h = make()
      const input = { sha: 'abc1234', report, detailsUrl: 'https://ci/x' }
      const id = await h.provider.upsertCheckRun(h.externalId, h.repo, input)
      expect(id).not.toBe('')
      expect(h.host.statusCount()).toBe(1)
      const again = await h.provider.upsertCheckRun(h.externalId, h.repo, {
        ...input,
        existingId: id,
      })
      expect(again).toBe(id)
      expect(h.host.statusCount()).toBe(1)
    })

    it('keeps one summary comment: creates it, edits it, and finds it again after a lost id', async () => {
      const h = make()
      const id = await h.provider.upsertComment(h.externalId, h.repo, h.prNumber, commentBody(1))
      expect(h.host.comments()).toEqual([commentBody(1)])
      const edited = await h.provider.upsertComment(
        h.externalId,
        h.repo,
        h.prNumber,
        commentBody(2),
        id,
      )
      expect(edited).toBe(id)
      expect(h.host.comments()).toEqual([commentBody(2)])
      const found = await h.provider.upsertComment(h.externalId, h.repo, h.prNumber, commentBody(3))
      expect(found).toBe(id)
      expect(h.host.comments()).toEqual([commentBody(3)])
    })

    it('writes a new comment when someone deleted the old one', async () => {
      const h = make()
      const id = await h.provider.upsertComment(h.externalId, h.repo, h.prNumber, PR_COMMENT_MARKER)
      h.host.deleteComments()
      const next = await h.provider.upsertComment(
        h.externalId,
        h.repo,
        h.prNumber,
        `${PR_COMMENT_MARKER} again`,
        id,
      )
      expect(next).not.toBe(id)
      expect(h.host.comments()).toEqual([`${PR_COMMENT_MARKER} again`])
    })

    it('accepts a correctly signed webhook and nothing else', () => {
      const h = make()
      const body = '{"zen":"hi"}'
      expect(h.provider.verifyWebhook(body, h.signed(body))).toBe(true)
      expect(h.provider.verifyWebhook(Buffer.from(body), h.signed(body))).toBe(true)
      // A signature covers the body; a shared token cannot tell a changed body apart.
      expect(h.provider.verifyWebhook(`${body} `, h.signed(body))).toBe(h.tokenOnly === true)
      expect(h.provider.verifyWebhook(body, {})).toBe(false)
    })

    it('lists the repositories the connection can see', async () => {
      const h = make()
      const repos = await h.provider.listRepositories(h.externalId)
      expect(repos.map((r) => r.ref).toSorted()).toEqual(h.repositories.toSorted())
      for (const r of repos) expect(typeof r.private).toBe('boolean')
    })

    it('says so, without retrying, when the host reports the connection gone', async () => {
      const h = make()
      h.host.revoke()
      const err = await h.provider
        .upsertCheckRun(h.externalId, h.repo, {
          sha: 'abc1234',
          report,
          detailsUrl: 'https://ci/x',
        })
        .catch((e: unknown) => e)
      expect(isConnectionRevoked(err)).toBe(true)
    })
  })
}
