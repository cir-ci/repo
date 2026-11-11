import { createHash } from 'node:crypto'

import { type Build, type Database } from '#src/index.ts'

import { seedBuild } from './builds.ts'
import { seedDiff } from './screenshots.ts'

let n = 0

/** The file hash of the image called `tag` in a test ("A", "B"): a real 64-hex SHA-256. */
export const imageSha = (tag: string): string => createHash('sha256').update(tag).digest('hex')

export namespace seedMainRun {
  export interface Input {
    /** A completed run of this commit; reruns of one commit repeat it. A new commit by default. */
    commit?: string
    /** What each screenshot looked like: the tag of its image (see `imageSha`). */
    images: Record<string, string>
    /** The diff score of the screenshots that showed as changed (others are unchanged). */
    changed?: Record<string, number>
    /** Names whose size changed. */
    resized?: readonly string[]
    branch?: string
  }
}

/**
 * One completed default-branch build with the given screenshot images, the way the pipeline
 * leaves it: a screenshot per name and a diff per name (changed, with the score, for the names
 * in `changed`; unchanged otherwise).
 */
export async function seedMainRun(
  db: Database,
  projectId: string,
  input: seedMainRun.Input,
): Promise<Build> {
  n += 1
  const build = await seedBuild(db, projectId, {
    branch: input.branch ?? 'main',
    status: 'complete',
    commitSha: input.commit ?? `ffff${String(n).padStart(8, '0')}`,
  })
  for (const [name, headSha256] of Object.entries(input.images)) {
    const score = input.changed?.[name]
    // oxlint-disable-next-line no-await-in-loop -- a few rows, in order
    await seedDiff(db, {
      buildId: build.id,
      name,
      headSha256: imageSha(headSha256),
      status: score === undefined ? 'unchanged' : 'changed',
      ...(score === undefined ? {} : { score }),
      ...(input.resized?.includes(name) ? { sizeChanged: true } : {}),
    })
  }
  return build
}

/**
 * A run of default-branch builds, one commit each, where `names` flips between two images:
 * A, B, A, B... (every run after the first shows as changed). Flaky after two flip-flops.
 */
export async function seedFlipFlops(
  db: Database,
  projectId: string,
  name: string,
  images: readonly string[],
  score = 0.02,
): Promise<Build[]> {
  const made: Build[] = []
  for (const [i, image] of images.entries()) {
    const run = seedMainRun(db, projectId, {
      images: { [name]: image },
      ...(i === 0 ? {} : { changed: { [name]: score } }),
    })
    // oxlint-disable-next-line no-await-in-loop -- builds are numbered in order
    made.push(await run)
  }
  return made
}
