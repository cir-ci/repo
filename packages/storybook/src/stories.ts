import { record } from './viewports.ts'

export interface Story {
  id: string
  title: string
  name: string
}

/**
 * The stories in a built Storybook's `index.json`: `entries` (Storybook 7 and later, docs pages
 * left out) or `stories` (the older v3 index). Sorted by ID, so shards and names are stable.
 */
export function parseIndex(json: unknown): Story[] {
  const index = record(json)
  const entries = record(index?.entries) ?? record(index?.stories)
  if (!entries)
    throw new Error("index.json has no stories. Is this a built Storybook's index.json?")
  const stories: Story[] = []
  for (const [key, value] of Object.entries(entries)) {
    const entry = record(value)
    if (!entry) continue
    if (entry.type !== undefined && entry.type !== 'story') continue
    const title = entry.title ?? entry.kind
    const name = entry.name ?? entry.story
    if (typeof title !== 'string' || typeof name !== 'string') continue
    stories.push({ id: typeof entry.id === 'string' ? entry.id : key, title, name })
  }
  return stories.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Words kept, everything else a dash: `Primary Button!` is `primary-button`. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** `Components/Button` and `Primary` → `components/button/primary`, the name a screenshot has in CirCI. */
export function storyPath(story: Story): string {
  const parts = [...story.title.split('/'), story.name].map(slug).filter((part) => part !== '')
  return parts.length > 0 ? parts.join('/') : slug(story.id) || 'story'
}

/**
 * A name for each story. Two stories whose names come out the same (`Primary` and `primary`) would
 * overwrite each other: the second, in ID order, gets its ID appended.
 */
export function storyNames(stories: readonly Story[]): Map<Story, string> {
  const taken = new Set<string>()
  const names = new Map<Story, string>()
  for (const story of stories) {
    let name = storyPath(story)
    if (taken.has(name)) name = `${name}-${slug(story.id)}`
    taken.add(name)
    names.set(story, name)
  }
  return names
}

/** `*` matches within a path segment, `**` across segments, `?` one character. */
export function globToRegExp(glob: string): RegExp {
  let source = ''
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob.charAt(i)
    if (char === '*') {
      if (glob.charAt(i + 1) === '*') {
        i += 1
        if (glob.charAt(i + 1) === '/') {
          i += 1
          source += '(?:.*/)?'
        } else source += '.*'
      } else source += '[^/]*'
    } else if (char === '?') source += '[^/]'
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`, 'i')
}

function matches(patterns: readonly RegExp[], story: Story): boolean {
  const names = [story.id, `${story.title}/${story.name}`]
  return patterns.some((pattern) => names.some((name) => pattern.test(name)))
}

/** Stories matching `include` (all, when it is empty) and not matching `exclude`. */
export function filterStories(
  stories: readonly Story[],
  include: readonly string[] = [],
  exclude: readonly string[] = [],
): Story[] {
  const inc = include.map(globToRegExp)
  const exc = exclude.map(globToRegExp)
  return stories.filter(
    (story) => (inc.length === 0 || matches(inc, story)) && !matches(exc, story),
  )
}

/** This shard's stories: every `total`th one, from `index`, so shards are even and need no coordination. */
export function shardStories<T>(
  stories: readonly T[],
  shard?: { index: number; total: number },
): T[] {
  if (!shard) return [...stories]
  return stories.filter((_, i) => i % shard.total === shard.index)
}
