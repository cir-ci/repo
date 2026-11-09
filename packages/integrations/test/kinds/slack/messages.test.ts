import { describe, expect, it } from 'vitest'

import {
  buildApprovedMessage,
  buildRejectedMessage,
  escapeMrkdwn,
  reviewOverdueMessage,
  reviewRequestedMessage,
  SLACK_REASON_MAX,
  truncate as truncateSlackText,
} from '#src/kinds/slack/messages.ts'

const build = {
  teamName: 'Web',
  number: 12,
  branch: 'feature/login',
  url: 'https://ci.acme.io/acme/web/builds/12',
}

const sectionText = (m: { blocks: { type: string; text?: { text: string } }[] }) =>
  m.blocks.find((b) => b.type === 'section')?.text?.text ?? ''

describe('escapeMrkdwn / truncateSlackText', () => {
  it('escapes the three control characters, & first', () => {
    expect(escapeMrkdwn('a & b <c> &lt;')).toBe('a &amp; b &lt;c&gt; &amp;lt;')
  })

  it('cuts at the limit with an ellipsis and leaves short text alone', () => {
    expect(truncateSlackText('short', 10)).toBe('short')
    expect(truncateSlackText('abcdefghij', 10)).toBe('abcdefghij')
    expect(truncateSlackText('abcdefghijk', 10)).toBe('abcdefghi…')
    expect(Array.from(truncateSlackText('😀'.repeat(20), 5))).toHaveLength(5)
  })
})

describe('reviewRequestedMessage', () => {
  it('names the reviewer, links the build and has an Open build button', () => {
    const m = reviewRequestedMessage({
      build,
      reviewer: 'Lou',
      requestedBy: 'Ada',
      dueAt: new Date('2026-03-10T12:00:00Z'),
    })
    expect(m.text).toBe('Review requested: Web #12 (Lou)')
    const text = sectionText(m)
    expect(text).toContain(
      'Ada asked *Lou* to review <https://ci.acme.io/acme/web/builds/12|Web #12>',
    )
    expect(text).toContain('`feature/login`')
    expect(text).toContain('<!date^1773144000^')
    expect(JSON.stringify(m.blocks)).toContain(`"url":"${build.url}"`)
  })

  it('says again for a re-request and works without asker or due time', () => {
    const m = reviewRequestedMessage({ build, reviewer: 'Lou', again: true })
    expect(m.text).toContain('requested again')
    expect(sectionText(m)).toContain('Asked *Lou* to look again at')
    expect(sectionText(m)).not.toContain('Due')
  })

  it('escapes names and branches that carry mrkdwn characters', () => {
    const m = reviewRequestedMessage({
      build: { ...build, teamName: 'A & <B>', branch: 'fix/<x>&`y`' },
      reviewer: '<!channel> & co',
      requestedBy: '<@U1>',
    })
    const text = sectionText(m)
    expect(text).toContain('&lt;@U1&gt; asked *&lt;!channel&gt; &amp; co*')
    expect(text).toContain('|A &amp; &lt;B&gt; #12>')
    expect(text).toContain("`fix/&lt;x&gt;&amp;'y'`")
    expect(text).not.toContain('<!channel>')
  })

  it('keeps a hostile url from closing the link', () => {
    const m = reviewRequestedMessage({
      build: { ...build, url: 'https://x.io/a?b=1&c=<2>|3' },
      reviewer: 'L',
    })
    expect(sectionText(m)).toContain('<https://x.io/a?b=1&amp;c=%3C2%3E%7C3|Web #12>')
  })
})

describe('reviewOverdueMessage', () => {
  it('says whose review is overdue and since when', () => {
    const m = reviewOverdueMessage({ build, reviewer: 'Lou', dueAt: new Date(1_000_000_000_000) })
    expect(m.text).toBe('Review overdue: Web #12')
    expect(sectionText(m)).toContain('*Lou*’s review of')
    expect(sectionText(m)).toContain('It was due <!date^1000000000^')
  })
})

describe('buildRejectedMessage', () => {
  it('quotes the reason, escaped, a line at a time', () => {
    const m = buildRejectedMessage({
      build,
      reviewer: 'Lou',
      reason: 'Header <h1> overlaps & shifts\nsecond line',
    })
    expect(m.text).toBe('Changes rejected: Web #12')
    expect(sectionText(m)).toContain('> Header &lt;h1&gt; overlaps &amp; shifts\n> second line')
  })

  it('truncates a long reason and omits a blank one', () => {
    const long = buildRejectedMessage({ build, reviewer: 'Lou', reason: 'x'.repeat(5000) })
    const quoted = sectionText(long).split('\n').at(-1) ?? ''
    expect(Array.from(quoted.slice(2))).toHaveLength(SLACK_REASON_MAX)
    expect(quoted.endsWith('…')).toBe(true)
    expect(
      sectionText(buildRejectedMessage({ build, reviewer: 'Lou', reason: '  ' })),
    ).not.toContain('\n> ')
    expect(sectionText(buildRejectedMessage({ build, reviewer: 'Lou' }))).not.toContain('\n> ')
  })

  it('never exceeds the 3000 characters a section may hold', () => {
    const m = buildRejectedMessage({
      build: { ...build, branch: 'b'.repeat(5000) },
      reviewer: 'n'.repeat(5000),
      reason: '&'.repeat(5000),
    })
    expect(Array.from(sectionText(m)).length).toBeLessThanOrEqual(3000)
  })
})

describe('buildApprovedMessage', () => {
  it('says who approved', () => {
    const m = buildApprovedMessage({ build, reviewer: 'Lou' })
    expect(m.text).toBe('Changes approved: Web #12')
    expect(sectionText(m)).toContain('*Lou* approved the changes')
  })
})
