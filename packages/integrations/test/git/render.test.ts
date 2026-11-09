import { describe, expect, it } from 'vitest'

import {
  checkReport,
  describeCounts,
  parseCommand,
  PR_COMMENT_MARKER,
  prCommentBody,
  type ReportedBuild,
} from '#src/git/render.ts'

const build = (over: Partial<ReportedBuild> = {}): ReportedBuild => ({
  number: 7,
  name: 'default',
  status: 'complete',
  conclusion: 'changes_detected',
  reviewStatus: 'pending',
  prNumber: 12,
  errorMessage: null,
  counts: { added: 1, removed: 0, changed: 3, failed: 0, total: 10 },
  url: 'https://ci.acme.io/acme/web/builds/7',
  ...over,
})

describe('checkReport', () => {
  it('holds unreviewed changes at action_required when merges are blocked, with both buttons', () => {
    const r = checkReport(build(), { blockMergeOnChanges: true })
    expect(r).toMatchObject({
      name: 'CirCI / default',
      status: 'completed',
      conclusion: 'action_required',
      title: '3 changed · 1 added: review required',
    })
    expect(r.actions.map((a) => a.identifier)).toEqual(['approve', 'reject'])
    expect(r.summary).toContain('https://ci.acme.io/acme/web/builds/7')
  })

  it('passes a flaky-only change when flaky screenshots do not block, and says so', () => {
    const flaky = build({
      flakyOnly: true,
      counts: { added: 0, removed: 0, changed: 1, failed: 0, total: 4 },
    })
    const r = checkReport(flaky, {
      blockMergeOnChanges: true,
      flakyBlocksMerge: false,
    })
    expect(r).toMatchObject({
      conclusion: 'success',
      title: 'Only flaky screenshots changed (1 changed)',
    })
    expect(r.summary).toContain('keep changing on the default branch')
    // The buttons are still offered, and the other rules still apply.
    expect(r.actions.map((a) => a.identifier)).toEqual(['approve', 'reject'])
    expect(
      checkReport(flaky, { blockMergeOnChanges: true, flakyBlocksMerge: true }).conclusion,
    ).toBe('action_required')
    expect(checkReport(flaky, { blockMergeOnChanges: true }).conclusion).toBe('action_required')
    expect(
      checkReport(
        { ...flaky, reviewStatus: 'rejected' },
        {
          blockMergeOnChanges: true,
          flakyBlocksMerge: false,
        },
      ).conclusion,
    ).toBe('failure')
  })

  it('passes unreviewed changes when merges are not blocked', () => {
    expect(checkReport(build(), { blockMergeOnChanges: false }).conclusion).toBe('success')
  })

  it('follows the review: approved passes, rejected fails, and each offers the other button', () => {
    const approved = checkReport(build({ reviewStatus: 'approved' }), {
      blockMergeOnChanges: true,
    })
    expect(approved.conclusion).toBe('success')
    expect(approved.actions.map((a) => a.identifier)).toEqual(['reject'])
    const rejected = checkReport(build({ reviewStatus: 'rejected' }), {
      blockMergeOnChanges: false,
    })
    expect(rejected.conclusion).toBe('failure')
    expect(rejected.actions.map((a) => a.identifier)).toEqual(['approve'])
  })

  it('succeeds without buttons when nothing changed, and is in progress while processing', () => {
    const none = checkReport(build({ conclusion: 'no_changes' }), {
      blockMergeOnChanges: true,
    })
    expect(none).toMatchObject({ conclusion: 'success', actions: [] })
    const running = checkReport(build({ status: 'processing', conclusion: null }), {
      blockMergeOnChanges: true,
    })
    expect(running.status).toBe('in_progress')
    expect(running.conclusion).toBeUndefined()
  })

  it('fails on a processing error, or warns when merges are not blocked', () => {
    const failed = build({
      status: 'error',
      errorMessage: 'bad png',
      conclusion: null,
    })
    expect(checkReport(failed, { blockMergeOnChanges: true })).toMatchObject({
      conclusion: 'failure',
      title: 'Processing failed',
    })
    expect(checkReport(failed, { blockMergeOnChanges: false }).conclusion).toBe('neutral')
  })
})

const decided = (reviewStatus: string, review: ReportedBuild['review']) =>
  prCommentBody([build({ reviewStatus, ...(review ? { review } : {}) })])

describe('pull request comment', () => {
  it('has a marker and a row per build name', () => {
    const body = prCommentBody([
      build(),
      build({ name: 'vitest-chromium', conclusion: 'no_changes', number: 8 }),
    ])
    expect(body.startsWith(PR_COMMENT_MARKER)).toBe(true)
    expect(body).toContain(
      '| [default](https://ci.acme.io/acme/web/builds/7) | 🟡 Changes detected | 3 changed · 1 added | [Review](',
    )
    expect(body).toContain('| ✅ No changes | — | — |')
  })

  it('shows who approved or rejected, and the per-snapshot counts when they are mixed', () => {
    expect(
      decided('approved', { approved: 4, rejected: 0, pending: 0, decidedBy: 'Ana' }),
    ).toContain('| ✅ Approved by Ana |')
    expect(
      decided('approved', { approved: 4, rejected: 0, pending: 0, decidedBy: null }),
    ).toContain('| ✅ Approved |')
    expect(
      decided('rejected', { approved: 2, rejected: 1, pending: 0, decidedBy: 'Bo' }),
    ).toContain('| ❌ Rejected by Bo (2 approved · 1 rejected) |')
    expect(decided('pending', { approved: 2, rejected: 0, pending: 3, decidedBy: null })).toContain(
      '| [Review](https://ci.acme.io/acme/web/builds/7) (2 approved · 3 pending) |',
    )
    // Nothing decided: just the link, as before.
    expect(decided('pending', { approved: 0, rejected: 0, pending: 4, decidedBy: null })).toContain(
      '| [Review](https://ci.acme.io/acme/web/builds/7) |',
    )
    expect(decided('approved', undefined)).toContain('| ✅ Approved |')
  })

  it('lists the hosted sites of the commit with their kind, and leaves the section out without any', () => {
    const sites = [
      { name: 'web-sb', kindLabel: 'Storybook', url: 'https://abc-web-storybook.sites.test' },
      { name: 'ui-report', kindLabel: 'Playwright report', url: 'https://abc-web-ui.sites.test' },
      { name: 'Coverage', kindLabel: 'Coverage', url: 'https://abc-web-cov.sites.test' },
    ]
    const body = prCommentBody([build()], { sites })
    expect(body).toContain('**Hosted sites for this commit**')
    expect(body).toContain('- [web-sb](https://abc-web-storybook.sites.test) · Storybook')
    expect(body).toContain('- [ui-report](https://abc-web-ui.sites.test) · Playwright report')
    // The kind is not repeated when it is the name.
    expect(body).toContain('- [Coverage](https://abc-web-cov.sites.test)\n')
    expect(prCommentBody([build()], { sites: [] })).not.toContain('Hosted sites')
    expect(prCommentBody([build()])).not.toContain('Hosted sites')
    expect(body.indexOf('Hosted sites')).toBeLessThan(body.indexOf('Reply `/circi approve`'))
  })

  it('describes counts', () => {
    expect(describeCounts({ added: 0, removed: 2, changed: 0, failed: 1, total: 3 })).toBe(
      '2 removed · 1 failed',
    )
  })
})

describe('parseCommand', () => {
  it('reads /circi commands, and nothing else', () => {
    expect(parseCommand('/circi approve')).toBe('approve')
    expect(parseCommand('Looks fine.\n  /CirCI Reject  \nthanks')).toBe('reject')
    expect(parseCommand('/circi rerun')).toBe('rerun')
    expect(parseCommand('please /circi approve this')).toBeUndefined()
    expect(parseCommand('/circi delete')).toBeUndefined()
  })
})
