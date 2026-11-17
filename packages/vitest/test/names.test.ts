import { describe, expect, it } from 'vitest'

import { captureName, capturePath } from '#src/names.ts'

describe('captureName', () => {
  it("applies Vitest's own rule, so a name means the same file in both", () => {
    expect(captureName('hero')).toBe('hero')
    expect(captureName('Settings Page')).toBe('Settings-Page')
    expect(captureName('button/variants/light')).toBe('button/variants/light')
    expect(captureName('hero.png')).toBe('hero')
  })

  it('names an unnamed call from its test name and its number, the same on every run', () => {
    expect(captureName('card > renders 2')).toBe('card-renders-2')
    expect(captureName('card > renders 2')).toBe(captureName('card > renders 2'))
  })

  it('never leaves its folder', () => {
    expect(captureName('../../etc/passwd')).toBe('etc/passwd')
    expect(captureName('/abs/olute')).toBe('abs/olute')
    expect(() => captureName('///')).toThrow(/usable/)
  })
})

describe('capturePath', () => {
  it('puts a capture under the test file, so equal names in two files never share a file', () => {
    expect(capturePath('.circi/screenshots', 'src/card.test.tsx', 'hero')).toBe(
      '.circi/screenshots/src/card.test.tsx/hero.png',
    )
    expect(capturePath('.circi/shots/', 'a/b.test.ts', 'x/y')).toBe(
      '.circi/shots/a/b.test.ts/x/y.png',
    )
  })

  it('keeps a test file path inside the folder', () => {
    expect(capturePath('d', '../outside.test.ts', 'a')).toBe('d/outside.test.ts/a.png')
  })
})
