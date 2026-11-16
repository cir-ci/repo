import { describe, expect, it } from 'vitest'

import {
  missingEntries,
  precacheEntries,
  staleEntries,
  withoutHash,
} from '../../src/sw/precache.ts'

const icon = '/n/lucide-react/dist/esm/icons/zap.mjs'

describe('precacheEntries', () => {
  const list = precacheEntries([
    { fileName: 'index.html' },
    { fileName: 'assets/logo-CzlLVkmI.svg' },
    { fileName: 'assets/index-BfQYrdej.js', name: 'index', moduleIds: ['/src/main.tsx'] },
    { fileName: 'assets/index-Dk0HaEoK.css' },
    { fileName: 'assets/index-BfQYrdej.js.map' },
    { fileName: 'assets/zap-AbCdEfGh.js', name: 'zap', moduleIds: [icon] },
    { fileName: 'assets/icons-DtBZtYi8.js', name: 'icons', moduleIds: [icon, `${icon}x`] },
    { fileName: 'assets/inter-latin-wght-normal-Dx4kXJAl.woff2' },
    { fileName: 'assets/inter-cyrillic-wght-normal-DqGufNeO.woff2' },
    { fileName: 'assets/index-BfQYrdej.js' },
  ])

  it('lists the hashed scripts, styles, images and Latin fonts, scripts and styles first', () => {
    expect(list).toEqual([
      '/assets/icons-DtBZtYi8.js',
      '/assets/index-BfQYrdej.js',
      '/assets/index-Dk0HaEoK.css',
      '/assets/inter-latin-wght-normal-Dx4kXJAl.woff2',
      '/assets/logo-CzlLVkmI.svg',
    ])
  })

  it("leaves out the page, source maps, a single picker icon and other scripts' fonts", () => {
    expect(list).not.toContain('/index.html')
    expect(list.some((p) => p.endsWith('.map'))).toBe(false)
    expect(list).not.toContain('/assets/zap-AbCdEfGh.js')
    expect(list.some((p) => p.includes('cyrillic'))).toBe(false)
  })
})

describe('withoutHash', () => {
  it('drops the eight-character hash before the extension', () => {
    expect(withoutHash('/assets/index-BfQYrdej.js')).toBe('/assets/index.js')
    expect(withoutHash('/assets/inter-latin-wght-normal-Dx4kXJAl.woff2')).toBe(
      '/assets/inter-latin-wght-normal.woff2',
    )
  })
})

describe('staleEntries and missingEntries', () => {
  const manifest = ['/assets/index-NEW00000.js', '/assets/BuildPage-NEW00000.js']
  const kept = [
    '/',
    '/icons/192.png',
    '/assets/index-OLD00000.js',
    '/assets/index-NEW00000.js',
    '/assets/zap-AbCdEfGh.js',
  ]

  it("deletes an older build's file of the same name, and nothing else", () => {
    expect(staleEntries(kept, manifest)).toEqual(['/assets/index-OLD00000.js'])
  })

  it('fetches what the manifest has and the cache lacks', () => {
    expect(missingEntries(kept, manifest)).toEqual(['/assets/BuildPage-NEW00000.js'])
  })
})
