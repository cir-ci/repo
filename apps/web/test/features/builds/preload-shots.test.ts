import { afterEach, describe, expect, it } from 'vitest'

import {
  forgetWarmed,
  type Loader,
  preloadImages,
  shotsToPreload,
} from '#features/builds/preload-shots.ts'

const image = (sha256: string) => ({ sha256, width: 1, height: 1 })
const shot = (id: string, over: { base?: boolean; head?: boolean; diff?: boolean } = {}) => ({
  id,
  base: over.base === false ? null : image(`${id}-base`),
  head: over.head === false ? null : image(`${id}-head`),
  diff: over.diff === false ? null : image(`${id}-diff`),
})
const address = (sha: string) => `/f/${sha}`

afterEach(forgetWarmed)

describe('shotsToPreload', () => {
  const ordered = [shot('a'), shot('b'), shot('c'), shot('d'), shot('e')]

  it('lists the next screenshot first, then the previous, then the one after next', () => {
    expect(shotsToPreload(ordered, { id: 'c' }, address)).toEqual([
      '/f/d-head',
      '/f/d-diff',
      '/f/d-base',
      '/f/b-head',
      '/f/b-diff',
      '/f/b-base',
      '/f/e-head',
      '/f/e-diff',
      '/f/e-base',
    ])
  })

  it('stops at either end of the list and skips images a screenshot has none of', () => {
    expect(
      shotsToPreload([shot('a'), shot('b', { base: false, diff: false })], { id: 'a' }, address),
    ).toEqual(['/f/b-head'])
    expect(shotsToPreload(ordered, { id: 'e' }, address)).toEqual([
      '/f/d-head',
      '/f/d-diff',
      '/f/d-base',
    ])
  })

  it('has nothing for no selection or one that is not in the list', () => {
    expect(shotsToPreload(ordered, undefined, address)).toEqual([])
    expect(shotsToPreload(ordered, { id: 'zzz' }, address)).toEqual([])
  })
})

const noop = () => {}

/** Loaders whose decode the test settles by hand. */
function fakeLoaders() {
  const made: (Loader & { done: () => void })[] = []
  const create = (): Loader => {
    let done: () => void = noop
    const decoded = new Promise<void>((resolve) => {
      done = resolve
    })
    const loader = { fetchPriority: '', decoding: '', src: '', decode: () => decoded, done }
    made.push(loader)
    return loader
  }
  return { made, create }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('preloadImages', () => {
  it('loads one at a time, at low priority, and skips what is already warmed', async () => {
    const { made, create } = fakeLoaders()
    preloadImages(['/a', '/b'], create)
    await tick()
    expect(made).toHaveLength(1)
    expect(made[0]).toMatchObject({ src: '/a', fetchPriority: 'low', decoding: 'async' })
    made[0]?.done()
    await tick()
    expect(made.map((m) => m.src)).toEqual(['/a', '/b'])
    made[1]?.done()
    await tick()
    const again = fakeLoaders()
    preloadImages(['/a', '/b'], again.create)
    expect(again.made).toHaveLength(0)
  })

  it('stops when canceled: the image in flight is dropped and the rest never start', async () => {
    const { made, create } = fakeLoaders()
    const cancel = preloadImages(['/a', '/b', '/c'], create)
    await tick()
    cancel()
    expect(made[0]?.src).toBe('')
    made[0]?.done()
    await tick()
    expect(made).toHaveLength(1)
  })

  it('goes on after an image that fails to decode', async () => {
    const made: string[] = []
    const create = (): Loader => {
      const loader = {
        fetchPriority: '',
        decoding: '',
        src: '',
        decode: () => (made.length === 0 ? Promise.reject(new Error('bad')) : Promise.resolve()),
      }
      made.push('x')
      return loader
    }
    preloadImages(['/a', '/b'], create)
    await tick()
    await tick()
    expect(made).toHaveLength(2)
  })
})
