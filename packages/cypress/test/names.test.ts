import { describe, expect, it } from 'vitest'

import { captureName, capturePath, specFolder } from '#src/names.ts'

describe('captureName', () => {
  it('keeps words and folders, and drops the rest, as @circi/vitest does', () => {
    expect(captureName('button/primary')).toBe('button/primary')
    expect(captureName('Home page (dark)')).toBe('Home-page-dark')
    expect(captureName('home.png')).toBe('home')
  })

  it('never escapes upward', () => {
    expect(captureName('../../etc/passwd')).toBe('etc/passwd')
    expect(captureName('./a//b')).toBe('a/b')
  })

  it('rejects a name with nothing usable in it', () => {
    expect(() => captureName('...')).toThrow('is not a usable screenshot name')
    expect(() => captureName('')).toThrow('is not a usable screenshot name')
  })
})

describe('specFolder and capturePath', () => {
  it('uses the spec file as the folder, so equal names in two specs never collide', () => {
    expect(capturePath('.circi/screenshots', 'home.cy.ts', 'hero')).toBe(
      '.circi/screenshots/home.cy.ts/hero.png',
    )
    expect(capturePath('.circi/screenshots/', 'cypress/e2e/a.cy.ts', 'hero')).toBe(
      '.circi/screenshots/cypress/e2e/a.cy.ts/hero.png',
    )
  })

  it('keeps a spec path inside the folder, and has a folder for an unknown spec', () => {
    expect(specFolder('../../x.cy.ts')).toBe('x.cy.ts')
    expect(specFolder('a\\b.cy.ts')).toBe('a/b.cy.ts')
    expect(specFolder(undefined)).toBe('unknown-spec')
    expect(specFolder('')).toBe('unknown-spec')
  })
})
