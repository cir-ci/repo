import type { Comment } from '@circi/api'
import { describe, expect, it } from 'vitest'

import { regionFromPoints, regionStyle, regionThreads } from '#features/builds/regions.ts'

const box = { left: 100, top: 50, width: 400, height: 200 }

describe('regionFromPoints', () => {
  it('turns a drag into fractions of the image', () => {
    expect(regionFromPoints(box, { x: 140, y: 100 }, { x: 300, y: 200 })).toEqual({
      x: 0.1,
      y: 0.25,
      width: 0.4,
      height: 0.5,
    })
  })

  it('works whichever way the drag goes', () => {
    expect(regionFromPoints(box, { x: 300, y: 200 }, { x: 140, y: 100 })).toEqual(
      regionFromPoints(box, { x: 140, y: 100 }, { x: 300, y: 200 }),
    )
  })

  it('clips a drag that leaves the image', () => {
    expect(regionFromPoints(box, { x: 0, y: 0 }, { x: 900, y: 150 })).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 0.5,
    })
  })

  it('treats a click, a sliver or an empty box as no region', () => {
    expect(regionFromPoints(box, { x: 200, y: 100 }, { x: 201, y: 101 })).toBeNull()
    expect(regionFromPoints(box, { x: 200, y: 100 }, { x: 400, y: 100 })).toBeNull()
    expect(regionFromPoints({ ...box, width: 0 }, { x: 0, y: 0 }, { x: 9, y: 9 })).toBeNull()
  })
})

describe('regionStyle', () => {
  it('places the region in percent', () => {
    expect(regionStyle({ x: 0.1, y: 0.25, width: 0.4, height: 0.5 })).toEqual({
      left: '10%',
      top: '25%',
      width: '40%',
      height: '50%',
    })
  })
})

describe('regionThreads', () => {
  const region: Comment.Region = { x: 0, y: 0, width: 0.5, height: 0.5 }
  const make = (id: string, over: Partial<Comment.Item>): Comment.Item => ({
    id,
    parentId: null,
    snapshotName: 'home',
    region,
    body: id,
    author: null,
    createdAt: '',
    editedAt: null,
    deletedAt: null,
    mine: false,
    canDelete: false,
    ...over,
  })

  it('keeps live top-level comments pinned on this snapshot', () => {
    const list = [
      make('a', {}),
      make('b', { snapshotName: 'pricing' }),
      make('c', { region: null }),
      make('d', { parentId: 'a' }),
      make('e', { deletedAt: 'x' }),
    ]
    expect(regionThreads(list, 'home').map((c) => c.id)).toEqual(['a'])
  })
})
