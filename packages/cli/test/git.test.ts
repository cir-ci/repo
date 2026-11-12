import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { collectAncestry, gitRunner, remoteBranchTip } from '#src/git.ts'

const exec = promisify(execFile)
const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
}
async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, env })
  return stdout.trim()
}
async function commit(cwd: string, msg: string): Promise<string> {
  await git(cwd, 'commit', '--allow-empty', '-q', '-m', msg)
  return git(cwd, 'rev-parse', 'HEAD')
}

let root: string
let remote: string
const c: Record<string, string> = {}

/**
 * History on the "remote":
 *
 *   m1 ─ m2 ─ m3 ─ m4        main
 *          └─ f1 ─ f2        feature (forked at m2)
 */
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'circi-git-'))
  remote = join(root, 'remote')
  await exec('git', ['init', '-q', '-b', 'main', remote], { env })
  // Commits must be created one after another, so no Promise.all here.
  c.m1 = await commit(remote, 'm1')
  c.m2 = await commit(remote, 'm2')
  await git(remote, 'checkout', '-q', '-b', 'feature')
  c.f1 = await commit(remote, 'f1')
  c.f2 = await commit(remote, 'f2')
  await git(remote, 'checkout', '-q', 'main')
  c.m3 = await commit(remote, 'm3')
  c.m4 = await commit(remote, 'm4')
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

let n = 0
/** A depth-1 clone of one branch, like CI checkouts (file:// so --depth is honoured). */
async function shallowClone(branch: string): Promise<string> {
  n += 1
  const dir = join(root, `clone-${n}`)
  await exec('git', ['clone', '-q', '--depth', '1', '--branch', branch, `file://${remote}`, dir], {
    env,
  })
  return dir
}

/** A full clone of one branch: all of its history, but not the other branches. */
async function fullClone(branch: string): Promise<string> {
  n += 1
  const dir = join(root, `full-${n}`)
  await exec(
    'git',
    ['clone', '-q', '--single-branch', '--branch', branch, `file://${remote}`, dir],
    { env },
  )
  return dir
}

describe('collectAncestry in a full clone', () => {
  it('finds the fork point without turning the clone shallow', async () => {
    const dir = await fullClone('feature')
    const before = await git(dir, 'rev-list', '--count', 'HEAD')
    const res = await collectAncestry(gitRunner(dir), {
      headSha: c.f2 ?? '',
      baseBranch: 'main',
      isBaseBranchBuild: false,
    })
    expect(res).toEqual({ status: 'ok', mergeBaseSha: c.m2, ancestorShas: [c.m2, c.m1] })
    expect(await git(dir, 'rev-parse', '--is-shallow-repository')).toBe('false')
    await expect(readFile(join(dir, '.git', 'shallow'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await git(dir, 'rev-list', '--count', 'HEAD')).toBe(before)
    // The fetch brought the base branch in whole.
    expect(await git(dir, 'rev-list', '--count', 'refs/remotes/origin/main')).toBe('4')
  })

  it('fetches a head it lacks without cutting history either', async () => {
    const dir = await fullClone('main')
    const res = await collectAncestry(gitRunner(dir), {
      headSha: c.f2 ?? '',
      baseBranch: 'main',
      isBaseBranchBuild: false,
    })
    expect(res).toMatchObject({ status: 'ok', mergeBaseSha: c.m2 })
    expect(await git(dir, 'rev-parse', '--is-shallow-repository')).toBe('false')
  })

  it('leaves a default-branch build in a full clone alone', async () => {
    const dir = await fullClone('main')
    const res = await collectAncestry(gitRunner(dir), {
      headSha: c.m4 ?? '',
      baseBranch: 'main',
      isBaseBranchBuild: true,
    })
    expect(res).toEqual({ status: 'ok', mergeBaseSha: c.m4, ancestorShas: [c.m3, c.m2, c.m1] })
    expect(await git(dir, 'rev-parse', '--is-shallow-repository')).toBe('false')
  })
})

describe('collectAncestry', () => {
  it('finds the fork point from a depth-1 PR checkout that lacks the base branch', async () => {
    const dir = await shallowClone('feature')
    const res = await collectAncestry(gitRunner(dir), {
      headSha: c.f2 ?? '',
      baseBranch: 'main',
      isBaseBranchBuild: false,
    })
    expect(res).toEqual({ status: 'ok', mergeBaseSha: c.m2, ancestorShas: [c.m2, c.m1] })
  })

  it('uses the PR head, not a synthetic merge commit checked out as HEAD', async () => {
    // GitHub checks out refs/pull/N/merge: main merged into the PR. Computing the merge-base from
    // that commit would give the tip of main (m4) and diff the PR against unrelated changes.
    const dir = await shallowClone('feature')
    await git(
      dir,
      'fetch',
      '-q',
      '--unshallow',
      'origin',
      '+refs/heads/main:refs/remotes/origin/main',
    )
    await git(dir, 'merge', '-q', '--no-edit', 'origin/main')
    const head = await git(dir, 'rev-parse', 'HEAD')
    expect(head).not.toBe(c.f2)

    const res = await collectAncestry(gitRunner(dir), {
      headSha: c.f2 ?? '',
      baseBranch: 'main',
      isBaseBranchBuild: false,
    })
    expect(res.mergeBaseSha).toBe(c.m2)
  })

  it('fetches the head commit by SHA when the checkout does not contain it', async () => {
    const dir = await shallowClone('main')
    const res = await collectAncestry(gitRunner(dir), {
      headSha: c.f2 ?? '',
      baseBranch: 'main',
      isBaseBranchBuild: false,
    })
    expect(res).toMatchObject({ status: 'ok', mergeBaseSha: c.m2 })
  })

  it('starts at the parent for default-branch builds, deepening a depth-1 clone', async () => {
    const dir = await shallowClone('main')
    const res = await collectAncestry(gitRunner(dir), {
      headSha: c.m4 ?? '',
      baseBranch: 'main',
      isBaseBranchBuild: true,
    })
    expect(res).toEqual({ status: 'ok', mergeBaseSha: c.m4, ancestorShas: [c.m3, c.m2, c.m1] })
  })

  it('caps the number of ancestors', async () => {
    const dir = await shallowClone('main')
    const res = await collectAncestry(gitRunner(dir), {
      headSha: c.m4 ?? '',
      baseBranch: 'main',
      isBaseBranchBuild: true,
      limit: 2,
    })
    expect(res.ancestorShas).toEqual([c.m3, c.m2])
  })

  it('reports missing history when fetching is disabled on a shallow clone', async () => {
    const dir = await shallowClone('feature')
    const res = await collectAncestry(gitRunner(dir), {
      headSha: c.f2 ?? '',
      baseBranch: 'main',
      isBaseBranchBuild: false,
      fetch: false,
    })
    expect(res).toMatchObject({ status: 'missing', ancestorShas: [] })
    expect(res.warning).toMatch(/Base branch "main" is not available/)
  })

  it('handles the very first commit of a repository', async () => {
    const dir = join(root, 'single')
    await exec('git', ['init', '-q', '-b', 'main', dir], { env })
    const only = await commit(dir, 'first')
    const res = await collectAncestry(gitRunner(dir), {
      headSha: only,
      baseBranch: 'main',
      isBaseBranchBuild: true,
    })
    expect(res).toEqual({ status: 'ok', mergeBaseSha: only, ancestorShas: [] })
  })

  it('reports missing history outside a git repository', async () => {
    const res = await collectAncestry(gitRunner(root), {
      headSha: 'abc1234',
      baseBranch: 'main',
      isBaseBranchBuild: false,
    })
    expect(res).toMatchObject({ status: 'missing', warning: 'Not inside a git repository' })
  })
})

describe('remoteBranchTip', () => {
  it('reads the tip of a branch on the remote', async () => {
    const dir = await shallowClone('feature')
    expect(await remoteBranchTip(gitRunner(dir), 'main')).toBe(c.m4)
    expect(await remoteBranchTip(gitRunner(dir), 'nope')).toBeUndefined()
  })
})
