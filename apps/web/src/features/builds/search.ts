/** The build page's route id and search params, kept render-free so components and tests can share them. */
export const ROUTE = '/$org/$project/builds/$number'

export type ViewMode = 'side' | 'overlay' | 'diff' | 'swipe'

export const VIEW_MODES: readonly ViewMode[] = ['side', 'overlay', 'diff', 'swipe']

export interface BuildSearch {
  /** Selected screenshot, so a link can point straight at one change. */
  shot?: string
  mode?: ViewMode
}

const isViewMode = (value: unknown): value is ViewMode => VIEW_MODES.some((mode) => mode === value)

export function validateBuildSearch(search: Record<string, unknown>): BuildSearch {
  return {
    ...(typeof search.shot === 'string' && search.shot ? { shot: search.shot } : {}),
    ...(isViewMode(search.mode) ? { mode: search.mode } : {}),
  }
}
