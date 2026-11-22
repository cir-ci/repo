import type { CirciOptions } from '@circi/cli'

export namespace circiStorybook {
  export type Browser = 'chromium' | 'firefox' | 'webkit'

  /** `1280x720`, `mobile=390x844`, or an object. The name labels the screenshot. */
  export type Viewport = string | { name?: string; width: number; height: number }

  /**
   * The addon's options, set in `.storybook/main.ts` (`addons: [circiStorybook({ … })]`) and
   * overridden by `circi-storybook upload`'s flags. The shared ones (`apiUrl`, `token`, `name`,
   * `dir`, `clean`, `root`, `wait`, `strict`, `shard`) mean what they do in `@circi/vitest`; `name`
   * defaults to `storybook`, and captures are written to `<dir>/storybook`.
   */
  export interface Options extends CirciOptions.Common {
    /** The built Storybook (`storybook build`), relative to the root. Default `storybook-static`. */
    staticDir?: string
    /** Run `storybook build` into `staticDir` first. Default false. */
    build?: boolean
    /** Default `['chromium']`. Playwright needs the browsers installed. */
    browsers?: Browser[]
    /** Default `['1280x720']`. A story's own `parameters.circi.viewports` or viewport wins. */
    viewports?: Viewport[]
    /** Stories screenshotted at once, per browser. Default 4. */
    concurrency?: number
    /** Globs over a story's ID or `Title/Story name`; only matching stories are screenshotted. */
    include?: string[]
    /** Globs, same form; matching stories are left out. */
    exclude?: string[]
    /** Also upload the built Storybook as a hosted site (named `storybook`, or the given name). Default false. */
    site?: boolean | { name?: string }
    /** Pixels of the page around the component to include. Default 0. */
    padding?: number
    /** Milliseconds to wait after a story has rendered, before the screenshot. Default 0. */
    delay?: number
    /** Seconds a story may take to render. Default 30. */
    timeout?: number
  }
}

/** A story's `parameters.circi`. */
export interface CirciParameters {
  /** Don't screenshot this story. */
  skip?: boolean
  /** Screenshot at each of these instead of the configured viewports. */
  viewports?: circiStorybook.Viewport[]
  /** Milliseconds to wait after the story has rendered. */
  delay?: number
  /** Screenshot this element (a CSS selector) instead of the whole component. */
  selector?: string
  /** Pixels around the component or element to include. */
  padding?: number
}
