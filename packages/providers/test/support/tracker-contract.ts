import { describe, expect, it } from 'vitest'

import { type IssueTracker, ProviderApiError } from '#src/index.ts'

/**
 * The contract every issue tracker adapter keeps. A tracker's test builds a harness (the adapter
 * pointed at a stateful fake of the tracker's HTTP edge) and runs `runIssueTrackerContract`.
 */
export interface TrackerHarness {
  tracker: IssueTracker
  /** The same adapter with credentials the fake host rejects. */
  rejected: IssueTracker
  account: IssueTracker.Account
  /** Targets the fake host has. */
  targets: IssueTracker.Target[]
  host: {
    /** What the fake host holds, oldest first. */
    issues(): { key: string; target: string; title: string; text: string }[]
  }
}

export function runIssueTrackerContract(name: string, make: () => TrackerHarness): void {
  describe(`${name}: IssueTracker contract`, () => {
    it('identifies the account the credentials belong to', async () => {
      const h = make()
      expect(await h.tracker.identify()).toEqual(h.account)
    })

    it('lists the places an issue can go', async () => {
      const h = make()
      expect(await h.tracker.listTargets()).toEqual(h.targets)
    })

    it('creates an issue with the title, the description and the image link', async () => {
      const h = make()
      const target = h.targets[0]?.ref ?? ''
      const issue = await h.tracker.createIssue({
        target,
        title: 'Visual regression: home',
        description: 'Build #4 rejected.\n\nSee https://ci.test/acme/web/builds/4',
        imageUrl: 'https://ci.test/api/files/abc',
      })
      expect(issue.title).toBe('Visual regression: home')
      expect(issue.key).toMatch(/^[A-Z]+-\d+$/)
      expect(issue.url).toContain(issue.key)
      const [stored, ...rest] = h.host.issues()
      expect(rest).toEqual([])
      expect(stored).toMatchObject({
        key: issue.key,
        target,
        title: 'Visual regression: home',
      })
      expect(stored?.text).toContain('Build #4 rejected.')
      expect(stored?.text).toContain('https://ci.test/api/files/abc')
    })

    it('gives each issue its own key', async () => {
      const h = make()
      const target = h.targets[0]?.ref ?? ''
      const a = await h.tracker.createIssue({
        target,
        title: 'a',
        description: 'a',
      })
      const b = await h.tracker.createIssue({
        target,
        title: 'b',
        description: 'b',
      })
      expect(a.key).not.toBe(b.key)
    })

    it('says the credentials are revoked when the host rejects them', async () => {
      const h = make()
      const err = await h.rejected.identify().catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ProviderApiError)
      expect(err).toMatchObject({ revoked: true })
    })

    it('fails, storing nothing, for a target that does not exist', async () => {
      const h = make()
      const err = await h.tracker
        .createIssue({ target: 'no-such-target', title: 't', description: 'd' })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ProviderApiError)
      expect(err).toMatchObject({ revoked: false })
      expect(h.host.issues()).toEqual([])
    })
  })
}
