import { describe, expect, it } from 'vitest'

import { requestPath, safeEntryPath, UnsafePathError } from '#src/paths.ts'

describe('safeEntryPath', () => {
  it('accepts ordinary paths and tidies them', () => {
    expect(safeEntryPath('index.html')).toBe('index.html')
    expect(safeEntryPath('./assets//app.js')).toBe('assets/app.js')
    expect(safeEntryPath('a/./b/c.css')).toBe('a/b/c.css')
  })

  it.each([
    '../etc/passwd',
    'a/../../b',
    'a/..',
    '/etc/passwd',
    'a\\b',
    'nul\0byte',
    '',
    '.',
    './',
    '_circi/nav.js',
    '_circi',
    './_circi/x',
  ])('rejects %j', (raw) => {
    expect(() => safeEntryPath(raw)).toThrow(UnsafePathError)
  })

  it('allows names that merely start like the reserved prefix', () => {
    expect(safeEntryPath('_circi-docs/index.html')).toBe('_circi-docs/index.html')
  })
})

describe('requestPath', () => {
  it('decodes, and refuses to leave the root', () => {
    expect(requestPath('/assets/app%20x.js')).toBe('assets/app x.js')
    expect(requestPath('/')).toBe('')
    expect(requestPath('/a/../b')).toBeUndefined()
    expect(requestPath('/%2e%2e/secret')).toBeUndefined()
    expect(requestPath('/a%5Cb')).toBeUndefined()
    expect(requestPath('/%00')).toBeUndefined()
    expect(requestPath('/%zz')).toBeUndefined()
  })
})
