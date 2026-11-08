import { describe, expect, it } from 'vitest'

import {
  channelItems,
  eventsSummary,
  initialEvents,
  installNote,
} from '#features/integrations/slack-api.ts'

describe('channelItems', () => {
  const channels = [
    { id: 'C1', name: 'web', private: false },
    { id: 'G1', name: 'design', private: true },
  ]

  it('shows public channels with # and says which are private', () => {
    expect(channelItems(channels, { id: null, name: null }).map((i) => i.label)).toEqual([
      '#web',
      'design (private)',
    ])
  })

  it('keeps a stored channel the bot can no longer see, first', () => {
    expect(channelItems(channels, { id: 'C9', name: 'old' })[0]).toEqual({
      value: 'C9',
      label: '#old',
      name: 'old',
    })
    expect(channelItems(channels, { id: 'C1', name: 'web' })).toHaveLength(2)
  })
})

describe('events', () => {
  it('starts a project that has none with the events that need action', () => {
    expect(initialEvents([])).toEqual(['review_requested', 'review_overdue', 'build_rejected'])
    expect(initialEvents(['build_approved'])).toEqual(['build_approved'])
  })

  it('summarises them', () => {
    expect(eventsSummary([])).toBe('No events')
    expect(eventsSummary(['review_requested', 'build_rejected'])).toBe(
      'Review requested, Build rejected',
    )
  })
})

describe('installNote', () => {
  it('says what happened after the redirect back from Slack', () => {
    expect(installNote('connected')?.tone).toBe('success')
    expect(installNote('denied')?.tone).toBe('danger')
    expect(installNote('failed')?.text).toContain('Try again')
    expect(installNote(undefined)).toBeNull()
    expect(installNote('whatever')).toBeNull()
  })
})
