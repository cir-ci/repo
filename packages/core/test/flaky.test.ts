import { describe, expect, it } from 'vitest'

import {
  assertFlakyAfterChanges,
  describeFlakyReason,
  flakyScreenshots,
  judgeFlaky,
  lastCommits,
  looksLikeKnownVariation,
  onlyFlakyChanges,
  type FlakyBuild,
  type FlakyShot,
} from '#src/index.ts'

let number = 0
/** A completed default-branch build of `commit`, with each name's image (null: no image). */
function build(
  commit: string,
  images: Record<string, string | null>,
  scores: Record<string, number> = {},
): FlakyBuild {
  number += 1
  const shots = new Map<string, FlakyShot>()
  for (const [name, image] of Object.entries(images)) {
    shots.set(name, {
      fileSha256: image,
      score: scores[name] ?? null,
      sizeChanged: false,
      changed: scores[name] !== undefined,
    })
  }
  return { number, commitSha: commit, shots }
}

/** One commit per image: `sequence('A', 'B', 'A')` is three commits showing those images. */
const sequence = (...images: string[]) =>
  images.map((image, i) => build(`c${number}-${i}`, { home: image }, { home: i === 0 ? 0 : 0.1 }))

const names = (builds: FlakyBuild[], threshold = 2) =>
  flakyScreenshots(builds, { threshold }).map((v) => v.name)

describe('flip-flops', () => {
  it('count a return to an earlier image, once per return', () => {
    const abab = flakyScreenshots(sequence('A', 'B', 'A', 'B'), { threshold: 2 })
    expect(abab).toHaveLength(1)
    expect(abab[0]).toMatchObject({ flipFlops: 2, reason: 'came back to an earlier image 2 times' })
    // A, B, A is one return: below the lowest threshold of 2.
    expect(names(sequence('A', 'B', 'A'))).toEqual([])
    expect(flakyScreenshots(sequence('A', 'B', 'A', 'B', 'A'), { threshold: 3 })[0]).toMatchObject({
      flipFlops: 3,
    })
  })

  it('never count a steady progression to new images', () => {
    expect(names(sequence('A', 'B', 'C', 'D', 'E', 'F'), 2)).toEqual([])
  })

  it('are counted between consecutive default-branch images, not against any baseline', () => {
    // Nothing in the input says what the baseline was: B, B, B, B is one image over four builds.
    expect(names(sequence('B', 'B', 'B', 'B'))).toEqual([])
  })

  it('need the threshold, which is never below 2', () => {
    const abab = sequence('A', 'B', 'A', 'B')
    expect(names(abab, 3)).toEqual([])
    expect(names(abab, 1)).toEqual(['home'])
    expect(names(sequence('A', 'B', 'A'), 1)).toEqual([])
  })

  it('only look at the last 10 distinct commits', () => {
    const old = sequence('A', 'B', 'A', 'B')
    const progression = sequence('C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L')
    // The old flip-flops are 10 commits back and out of the window.
    expect(names([...old, ...progression])).toEqual([])
    // Only the newest 10 commits count: 6 old ones are gone, leaving A, B, then 8 more.
    expect(names([...old, ...progression.slice(0, 6)])).toEqual(['home'])
    expect(names([...old, ...progression.slice(0, 7)])).toEqual([])
  })

  it('ignore builds where the screenshot has no image', () => {
    const builds = [
      build('c1', { home: 'A' }),
      build('c2', { home: null }),
      build('c3', { home: 'B' }),
      build('c4', { home: 'A' }),
      build('c5', { home: 'B' }),
    ]
    expect(names(builds)).toEqual(['home'])
  })
})

describe('reruns of one commit', () => {
  it('count as one point: a rerun with the same image changes nothing', () => {
    const builds = [
      build('c1', { home: 'A' }),
      build('c2', { home: 'B' }),
      build('c2', { home: 'B' }),
      build('c2', { home: 'B' }),
      build('c3', { home: 'A' }),
    ]
    // A, B, A is one flip-flop however often c2 ran.
    expect(flakyScreenshots(builds, { threshold: 2 })).toEqual([])
  })

  it('disagreeing is enough on its own: one commit, two images', () => {
    const builds = [
      build('c1', { home: 'A' }),
      build('c2', { home: 'A' }),
      build('c2', { home: 'B' }),
    ]
    const [v] = flakyScreenshots(builds, { threshold: 8 })
    expect(v).toMatchObject({
      name: 'home',
      flipFlops: 0,
      disagreements: { commits: 1, runs: 2 },
      reason: 'differed across 2 runs of one commit',
    })
  })

  it('does not count a commit whose runs agree, nor a rerun that lacks the image', () => {
    const builds = [
      build('c1', { home: 'A' }),
      build('c1', { home: 'A' }),
      build('c1', { home: null }),
    ]
    expect(flakyScreenshots(builds, { threshold: 2 })).toEqual([])
  })

  it('uses the latest run of a commit as its image in the sequence', () => {
    const builds = [
      build('c1', { home: 'A' }),
      build('c2', { home: 'B' }),
      build('c2', { home: 'A' }), // disagreement; c2 ends on A
      build('c3', { home: 'B' }),
    ]
    const [v] = flakyScreenshots(builds, { threshold: 2 })
    expect(v).toMatchObject({ disagreements: { commits: 1, runs: 2 }, flipFlops: 1 })
    expect(v?.reason).toBe(
      'differed across 2 runs of one commit and came back to an earlier image once',
    )
  })
})

describe('the verdict', () => {
  it('lists every image seen and the largest score, for the gate', () => {
    const builds = [
      build('c1', { home: 'A' }),
      build('c2', { home: 'B' }, { home: 0.02 }),
      build('c3', { home: 'A' }, { home: 0.04 }),
      build('c4', { home: 'B' }, { home: 0.03 }),
    ]
    const [v] = flakyScreenshots(builds, { threshold: 2 })
    expect(v).toMatchObject({ knownImages: ['A', 'B'], largestScore: 0.04, changedIn: 3 })
  })

  it('lists the worst first, then by name', () => {
    const builds = [
      build('c1', { a: 'A', b: 'A' }),
      build('c2', { a: 'B', b: 'B' }, { a: 0.1, b: 0.1 }),
      build('c3', { a: 'A', b: 'A' }, { a: 0.1, b: 0.1 }),
      build('c4', { a: 'B', b: 'B' }, { a: 0.1 }),
    ]
    expect(names(builds)).toEqual(['a', 'b'])
  })

  it('says nothing for an empty history, and judges one name alone', () => {
    expect(flakyScreenshots([], { threshold: 2 })).toEqual([])
    const commits = lastCommits(sequence('A', 'B', 'A', 'B'))
    expect(judgeFlaky('home', commits, 2)?.flipFlops).toBe(2)
    expect(judgeFlaky('other', commits, 2)).toBeNull()
  })
})

describe('describeFlakyReason', () => {
  it('names counts with their nouns', () => {
    const none = { commits: 0, runs: 0 }
    expect(describeFlakyReason({ flipFlops: 1, disagreements: none })).toBe(
      'came back to an earlier image once',
    )
    expect(describeFlakyReason({ flipFlops: 3, disagreements: none })).toBe(
      'came back to an earlier image 3 times',
    )
    expect(describeFlakyReason({ flipFlops: 0, disagreements: { commits: 2, runs: 3 } })).toBe(
      'differed across runs of 2 commits',
    )
  })
})

describe('known variation', () => {
  const flaky = { knownImages: ['A', 'B'], largestScore: 0.05 }
  const change = { fileSha256: 'Z', score: 0.04, sizeChanged: false }

  it('is an image the screenshot already had on the default branch', () => {
    expect(looksLikeKnownVariation({ fileSha256: 'A', score: 0.9, sizeChanged: true }, flaky)).toBe(
      true,
    )
  })

  it('is a small change of a new image, with the same size', () => {
    expect(looksLikeKnownVariation(change, flaky)).toBe(true)
    expect(looksLikeKnownVariation({ ...change, score: 0.05 }, flaky)).toBe(true)
  })

  it('is not a bigger change, a size change, or a change without a score', () => {
    expect(looksLikeKnownVariation({ ...change, score: 0.8 }, flaky)).toBe(false)
    expect(looksLikeKnownVariation({ ...change, sizeChanged: true }, flaky)).toBe(false)
    expect(looksLikeKnownVariation({ ...change, score: null }, flaky)).toBe(false)
  })
})

const entry = (name: string) => ({ name, reason: 'x', knownImages: ['A'], largestScore: 0.05 })
const small = (name: string) => ({ name, fileSha256: 'Q', score: 0.01, sizeChanged: false })

describe('onlyFlakyChanges', () => {
  const counts = { added: 0, removed: 0, changed: 2, failed: 0 }
  const flaky = [entry('wobble'), entry('blink')]

  it('is true when every changed screenshot is flaky and looks like its variation', () => {
    expect(onlyFlakyChanges({ counts, changes: [small('wobble'), small('blink')], flaky })).toBe(
      true,
    )
  })

  it("is false when one changed screenshot isn't flaky", () => {
    expect(onlyFlakyChanges({ counts, changes: [small('wobble'), small('steady')], flaky })).toBe(
      false,
    )
  })

  it('is false when a flaky screenshot changed far more than it ever wobbled', () => {
    const broken = { name: 'blink', fileSha256: 'Q', score: 0.8, sizeChanged: true }
    expect(onlyFlakyChanges({ counts, changes: [small('wobble'), broken], flaky })).toBe(false)
  })

  it.each(['added', 'removed', 'failed'] as const)('is false when something is %s', (kind) => {
    const c = { ...counts, changed: 1, [kind]: 1 }
    expect(onlyFlakyChanges({ counts: c, changes: [small('wobble')], flaky })).toBe(false)
  })

  it('is false without any change', () => {
    expect(onlyFlakyChanges({ counts: { ...counts, changed: 0 }, changes: [], flaky })).toBe(false)
  })
})

describe('the team threshold', () => {
  it('is 2 to 8 flip-flops: one is a normal revert, more than the window allows never happens', () => {
    for (const ok of [2, 3, 8]) expect(() => assertFlakyAfterChanges(ok)).not.toThrow()
    for (const bad of [0, 1, 9, 10, 2.5])
      expect(() => assertFlakyAfterChanges(bad)).toThrow(/flaky after 2 to 8 flip-flops/)
  })
})
