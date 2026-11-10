import { describe, expect, it } from 'vitest'

import {
  flakyEvidence,
  flakyReasonText,
  flakyScreenshots,
  type FlakyBuild,
  type FlakyShot,
} from '#src/index.ts'

let number = 0
/** A completed default-branch build of `commit` with the image of `home` (a build per call, numbered as made). */
function build(commit: string, image: string): FlakyBuild {
  number += 1
  const shot: FlakyShot = { fileSha256: image, score: null, sizeChanged: false, changed: true }
  return { number, commitSha: commit, shots: new Map([['home', shot]]) }
}

/** One commit per image. */
const sequence = (...images: string[]) => images.map((image, i) => build(`s${number}-${i}`, image))

const why = (builds: FlakyBuild[], threshold = 2) => flakyScreenshots(builds, { threshold })[0]?.why

describe('the reason', () => {
  it('names each return to an earlier image and the build whose image it came back to', () => {
    const builds = sequence('A', 'B', 'A', 'B')
    const [a, b, c, d] = builds.map((x) => x.number)
    const reason = why(builds)
    expect(reason).toEqual({
      kind: 'flip_flop',
      flipFlop: {
        count: 2,
        threshold: 2,
        window: 4,
        returns: [
          { build: c, backTo: a },
          { build: d, backTo: b },
        ],
      },
    })
    expect(flakyEvidence(reason!)).toEqual([
      { build: c, rest: ` went back to #${a}'s image` },
      { build: d, rest: ` went back to #${b}'s image` },
    ])
  })

  it('says a rerun disagreement with the build and how many runs differ', () => {
    const builds = [build('c1', 'A'), build('c2', 'A'), build('c2', 'A'), build('c2', 'B')]
    const last = builds[3]!.number
    const reason = why(builds, 8)
    expect(reason).toEqual({
      kind: 'reruns_disagree',
      reruns: { build: last, runs: 3, differing: 1, commits: 1 },
    })
    expect(flakyEvidence(reason!)).toEqual([{ build: last, rest: ': 1 of 3 runs differ' }])
    expect(flakyReasonText(reason!)).toBe('Differed across 3 runs of one commit')
  })

  it('combines both when they apply, the rerun evidence last', () => {
    const builds = [
      build('c1', 'A'),
      build('c2', 'B'),
      build('c2', 'A'),
      build('c3', 'B'),
      build('c4', 'A'),
    ]
    const reason = why(builds)
    expect(reason?.kind).toBe('both')
    expect(flakyEvidence(reason!).map((e) => e.rest)).toEqual([
      ` went back to #${builds[1]!.number}'s image`,
      ` went back to #${builds[0]!.number}'s image`,
      ': 1 of 2 runs differ',
    ])
    expect(flakyReasonText(reason!)).toBe(
      'Differed across 2 runs of one commit and came back to an earlier image 2 times',
    )
    expect(flakyReasonText(reason!, { detail: true })).toBe(
      "Differed across 2 runs of one commit and came back to an earlier image 2 times in the last 4 builds; the team's limit is 2, and one disagreement is enough.",
    )
  })

  it("words the short form, and the detailed one with the window and the team's limit", () => {
    const abab = why(sequence('A', 'B', 'A', 'B', 'A', 'B', 'A'), 3)!
    expect(flakyReasonText(abab)).toBe('Came back to an earlier image 5 times')
    expect(flakyReasonText(abab, { detail: true })).toBe(
      "Came back to an earlier image 5 times in the last 7 builds; the team's limit is 3.",
    )
    expect(flakyReasonText(abab, { inline: true })).toBe('came back to an earlier image 5 times')
  })

  it('never takes a limit below the lowest a team may ask for', () => {
    expect(why(sequence('A', 'B', 'A', 'B'), 0)).toMatchObject({ flipFlop: { threshold: 2 } })
  })

  it('says "once" for one return, and counts the commits when several disagree', () => {
    const once = why([build('c1', 'A'), build('c2', 'B'), build('c2', 'A'), build('c3', 'B')], 8)!
    expect(flakyReasonText(once)).toBe(
      'Differed across 2 runs of one commit and came back to an earlier image once',
    )
    const many = why([build('c1', 'A'), build('c1', 'B'), build('c2', 'A'), build('c2', 'B')], 8)!
    expect(flakyReasonText(many, { detail: true })).toBe(
      'Differed across runs of 2 commits; one disagreement is enough.',
    )
  })
})
