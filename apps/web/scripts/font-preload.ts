/**
 * The font the first paint needs, as a `<link rel="preload">`, so its download starts with the
 * page instead of after the stylesheet names it. Only Inter's Latin subset: the other subsets
 * (and the monospace font, used in code and IDs further in) load when a page needs them.
 */

export interface PreloadTag {
  tag: 'link'
  attrs: Record<string, string | boolean>
  injectTo: 'head-prepend'
}

/** The preload tags for the built `fileNames` (`assets/inter-latin-wght-normal-Dx4kXJAl.woff2`); none when the build has no such file. */
export function fontPreloadTags(fileNames: readonly string[]): PreloadTag[] {
  return fileNames
    .filter((name) => /(^|\/)inter-latin-wght-normal-[A-Za-z0-9_-]+\.woff2$/.test(name))
    .map((name) => ({
      tag: 'link',
      // `crossorigin` is required for fonts, even from the same origin, or the preload is wasted.
      attrs: { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: '', href: `/${name}` },
      injectTo: 'head-prepend',
    }))
}
