/** The build page's route id and search params, kept render-free so components and tests can share them. */
export const ROUTE = '/$workspace/$project/builds/$number'

/** The compare modes that need nothing but the build (keys 1 to 3). */
export type ImageMode = 'side' | 'diff' | 'slider'

/** `design` (key 5) compares with a Figma frame; it is only offered once the integration is on (Phase D). */
export type ViewMode = ImageMode | 'design'

export const VIEW_MODES: readonly ImageMode[] = ['side', 'diff', 'slider']

export const DESIGN_MODE: ViewMode = 'design'

export interface BuildSearch {
  /** Selected screenshot, so a link can point straight at one change. */
  shot?: string
  mode?: ViewMode
  /** `comments` opens the sidebar on its Comments tab (a link to a discussion). */
  sidebar?: 'comments'
  /** A comment to show: its thread is focused, and its snapshot selected if it is pinned to one. */
  comment?: string
}

const isViewMode = (value: unknown): value is ViewMode =>
  value === DESIGN_MODE || VIEW_MODES.some((mode) => mode === value)

export function validateBuildSearch(search: Record<string, unknown>): BuildSearch {
  // Links made while the mode was called "swipe" keep working.
  // Links made while the mode was called "swipe", or before Overlay became part of Diff, keep working.
  if (search.mode === 'swipe') search = { ...search, mode: 'slider' }
  if (search.mode === 'overlay') search = { ...search, mode: 'diff' }
  return {
    ...(typeof search.shot === 'string' && search.shot ? { shot: search.shot } : {}),
    ...(isViewMode(search.mode) ? { mode: search.mode } : {}),
    ...(search.sidebar === 'comments' ? { sidebar: 'comments' as const } : {}),
    ...(typeof search.comment === 'string' && search.comment ? { comment: search.comment } : {}),
  }
}
