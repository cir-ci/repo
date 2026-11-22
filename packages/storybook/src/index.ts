import type { circiStorybook as Types } from './types.ts'

export type { CirciParameters } from './types.ts'
export { uploadStorybook } from './run.ts'

/**
 * The CirCI addon for Storybook: list it in `.storybook/main.ts`, where its options live. The
 * `circi-storybook upload` command reads them from there; flags override them.
 *
 * ```ts
 * addons: [circiStorybook({ name: 'storybook', browsers: ['chromium'] })]
 * ```
 */
export function circiStorybook(options: Types.Options = {}): {
  name: string
  options: Types.Options
} {
  return { name: '@circi/storybook', options }
}

export namespace circiStorybook {
  export type Options = Types.Options
  export type Browser = Types.Browser
  export type Viewport = Types.Viewport
}
