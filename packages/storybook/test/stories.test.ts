import { describe, expect, it } from 'vitest'

import {
  filterStories,
  globToRegExp,
  parseIndex,
  shardStories,
  slug,
  storyNames,
  storyPath,
} from '#src/stories.ts'

const index = {
  v: 5,
  entries: {
    'components-button--primary': {
      type: 'story',
      id: 'components-button--primary',
      title: 'Components/Button',
      name: 'Primary',
    },
    'components-button--docs': {
      type: 'docs',
      id: 'components-button--docs',
      title: 'Components/Button',
      name: 'Docs',
    },
    'pages-home--default': {
      type: 'story',
      id: 'pages-home--default',
      title: 'Pages/Home',
      name: 'Default',
    },
  },
}

describe('parseIndex', () => {
  it('reads the stories of a Storybook 7 or later index, without docs pages, sorted by ID', () => {
    expect(parseIndex(index).map((s) => s.id)).toEqual([
      'components-button--primary',
      'pages-home--default',
    ])
  })

  it('reads the v3 index of older versions, which has `stories`, `kind` and `story`', () => {
    const v3 = {
      v: 3,
      stories: { 'a--b': { id: 'a--b', kind: 'A', story: 'B', name: 'B' } },
    }
    expect(parseIndex(v3)).toEqual([{ id: 'a--b', title: 'A', name: 'B' }])
  })

  it('says what is wrong when it is not an index', () => {
    expect(() => parseIndex({ nope: 1 })).toThrow(/no stories/)
    expect(() => parseIndex(null)).toThrow(/no stories/)
  })
})

describe('names', () => {
  it('are the title path and the story name, lowercase with dashes', () => {
    expect(storyPath({ id: 'x', title: 'Components/Button Group', name: 'With Icon!' })).toBe(
      'components/button-group/with-icon',
    )
    expect(slug('  Ünï  ')).toBe('n')
  })

  it('fall back to the ID for a story with no usable words', () => {
    expect(storyPath({ id: 'x--y', title: '***', name: '!!!' })).toBe('x-y')
  })

  it('tell apart two stories whose names come out the same, the later one gets its ID', () => {
    const a = { id: 'a--primary', title: 'Button', name: 'Primary' }
    const b = { id: 'b--primary', title: 'Button', name: 'primary' }
    const names = storyNames([a, b])
    expect(names.get(a)).toBe('button/primary')
    expect(names.get(b)).toBe('button/primary-b-primary')
  })
})

describe('filters', () => {
  const stories = parseIndex(index)

  it('keep everything without include or exclude', () => {
    expect(filterStories(stories)).toHaveLength(2)
  })

  it('match a glob against the story ID or Title/Story name, ignoring case', () => {
    expect(filterStories(stories, ['Components/**']).map((s) => s.id)).toEqual([
      'components-button--primary',
    ])
    expect(filterStories(stories, ['pages-home--*']).map((s) => s.id)).toEqual([
      'pages-home--default',
    ])
    expect(filterStories(stories, ['**/primary']).map((s) => s.id)).toEqual([
      'components-button--primary',
    ])
  })

  it('leave out what exclude matches, after include', () => {
    expect(filterStories(stories, ['**'], ['Pages/*/*']).map((s) => s.id)).toEqual([
      'components-button--primary',
    ])
  })

  it('treat `*` as one path segment and `**` as any', () => {
    expect(globToRegExp('A/*').test('A/B')).toBe(true)
    expect(globToRegExp('A/*').test('A/B/C')).toBe(false)
    expect(globToRegExp('A/**').test('A/B/C')).toBe(true)
    expect(globToRegExp('a?c').test('abc')).toBe(true)
    expect(globToRegExp('a.c').test('abc')).toBe(false)
  })
})

describe('shards', () => {
  const items = ['a', 'b', 'c', 'd', 'e']

  it('split stories evenly, every total-th from the shard number', () => {
    expect(shardStories(items, { index: 0, total: 2 })).toEqual(['a', 'c', 'e'])
    expect(shardStories(items, { index: 1, total: 2 })).toEqual(['b', 'd'])
  })

  it('keep everything without a shard', () => {
    expect(shardStories(items)).toEqual(items)
  })
})
