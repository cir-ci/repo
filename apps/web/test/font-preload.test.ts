import { describe, expect, it } from 'vitest'

import { fontPreloadTags } from '../scripts/font-preload.ts'

describe('fontPreloadTags', () => {
  it("preloads only Inter's Latin font, as a cross-origin font preload at the top of the head", () => {
    const tags = fontPreloadTags([
      'assets/index-BfQYrdej.js',
      'assets/inter-latin-ext-wght-normal-DO1Apj_S.woff2',
      'assets/inter-latin-wght-normal-Dx4kXJAl.woff2',
      'assets/inter-cyrillic-wght-normal-DqGufNeO.woff2',
      'assets/jetbrains-mono-latin-wght-normal-B9CIFXIH.woff2',
    ])
    expect(tags).toEqual([
      {
        tag: 'link',
        attrs: {
          rel: 'preload',
          as: 'font',
          type: 'font/woff2',
          crossorigin: '',
          href: '/assets/inter-latin-wght-normal-Dx4kXJAl.woff2',
        },
        injectTo: 'head-prepend',
      },
    ])
  })

  it('adds nothing when the build has no such file (the dev server)', () => {
    expect(fontPreloadTags([])).toEqual([])
  })
})
