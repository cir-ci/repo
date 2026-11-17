/** What the plugin hands the browser (through `test.provide`), under one key. */
export const PROVIDE_KEY = 'circi:screenshots'

export interface BrowserSettings {
  /** Also compare locally, as Vitest does without the plugin. */
  local: boolean
  /** Where captures go, relative to the project root. */
  dir: string
}

declare module 'vitest' {
  interface ProvidedContext {
    'circi:screenshots': BrowserSettings
  }
}
