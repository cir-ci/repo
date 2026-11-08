import { describe, expect, it } from 'vitest'

import { choiceOf, flakyChoices, isFlakyChoice, valueOf } from '#features/teams/flaky-setting.ts'

describe('flaky-setting', () => {
  it('maps the wire value to the control and back', () => {
    expect([null, true, false].map(choiceOf)).toEqual(['inherit', 'on', 'off'])
    expect((['inherit', 'on', 'off'] as const).map(valueOf)).toEqual([null, true, false])
  })

  it('spells out what inheriting means right now', () => {
    expect(flakyChoices(true)[0]?.label).toBe('Inherit from workspace (currently: on)')
    expect(flakyChoices(false)[0]?.label).toBe('Inherit from workspace (currently: off)')
    expect(flakyChoices(true).map((c) => c.value)).toEqual(['inherit', 'on', 'off'])
  })

  it('recognises only its own choices', () => {
    expect(['inherit', 'on', 'off'].every(isFlakyChoice)).toBe(true)
    expect(isFlakyChoice('maybe')).toBe(false)
  })
})
