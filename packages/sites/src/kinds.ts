/**
 * The kinds of static site CirCI hosts (PLAN §7.6). A kind is a small definition: how to
 * recognise it from its file list, its entry page, and whether it may run a service worker.
 * Adding one is one entry here: no schema, API or UI changes.
 */

export interface SiteKind {
  id: SiteKind.Id
  label: string
  /** For `--kind auto`: does this file list look like one of these? Paths use `/`, no leading `/`. */
  detect(files: ReadonlySet<string>): boolean
  /** The page served at the site's root. */
  entryPath(files: ReadonlySet<string>): string
  /** Unknown paths get the entry page (single-page apps) instead of a 404. */
  spaFallback: boolean
  /** May register a service worker (only honoured on commit addresses). */
  serviceWorker: boolean
}

export const SITE_KIND_IDS = [
  'storybook',
  'vitest-report',
  'playwright-report',
  'coverage',
  'docs',
  'generic',
] as const
export namespace SiteKind {
  export type Id = (typeof SITE_KIND_IDS)[number]
}

const has = (files: ReadonlySet<string>, ...paths: string[]) => paths.every((p) => files.has(p))
const anyUnder = (files: ReadonlySet<string>, prefix: string) =>
  [...files].some((f) => f.startsWith(prefix))

const index = () => 'index.html'

export const KINDS: Record<SiteKind.Id, SiteKind> = {
  storybook: {
    id: 'storybook',
    label: 'Storybook',
    detect: (f) => has(f, 'iframe.html') && (f.has('index.json') || f.has('stories.json')),
    entryPath: index,
    spaFallback: false,
    serviceWorker: false,
  },
  'vitest-report': {
    id: 'vitest-report',
    label: 'Vitest report',
    detect: (f) => has(f, 'index.html', 'html.meta.json.gz'),
    entryPath: index,
    spaFallback: false,
    serviceWorker: false,
  },
  'playwright-report': {
    id: 'playwright-report',
    label: 'Playwright report',
    detect: (f) => f.has('index.html') && anyUnder(f, 'data/') && anyUnder(f, 'trace/'),
    entryPath: index,
    spaFallback: false,
    // The trace viewer registers a service worker.
    serviceWorker: true,
  },
  coverage: {
    id: 'coverage',
    label: 'Coverage report',
    detect: (f) =>
      f.has('lcov-report/index.html') ||
      (f.has('index.html') &&
        (f.has('lcov.info') ||
          f.has('coverage-final.json') ||
          (f.has('base.css') && f.has('prettify.js')))),
    entryPath: (f) => (f.has('index.html') ? 'index.html' : 'lcov-report/index.html'),
    spaFallback: false,
    serviceWorker: false,
  },
  docs: {
    id: 'docs',
    label: 'Docs',
    // Explicit only: a documentation site looks like any other static folder.
    detect: () => false,
    entryPath: index,
    spaFallback: false,
    serviceWorker: false,
  },
  generic: {
    id: 'generic',
    label: 'Static site',
    detect: () => true,
    entryPath: index,
    spaFallback: false,
    serviceWorker: false,
  },
}

/** The first kind (most specific first) whose detector accepts the files; `generic` otherwise. */
export function detectKind(files: Iterable<string>): SiteKind {
  const set = new Set(files)
  const order: SiteKind.Id[] = ['storybook', 'playwright-report', 'vitest-report', 'coverage']
  for (const id of order) if (KINDS[id].detect(set)) return KINDS[id]
  return KINDS.generic
}

export function isSiteKindId(value: string): value is SiteKind.Id {
  return (SITE_KIND_IDS as readonly string[]).includes(value)
}
