import { describe, expect, it } from 'vitest'

import { buildTitle } from '#features/builds/build-title.ts'

describe('buildTitle', () => {
  it('is just the number for the usual "default" build', () => {
    expect(buildTitle(148)).toBe('Build #148')
    expect(buildTitle(148, 'default')).toBe('Build #148')
  })

  it("puts a build's own name after the number", () => {
    expect(buildTitle(3, 'storybook')).toBe('Build #3 · storybook')
  })

  it('ignores an empty name', () => {
    expect(buildTitle(3, '')).toBe('Build #3')
  })
})
