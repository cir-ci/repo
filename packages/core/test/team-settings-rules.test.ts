import { describe, expect, it } from 'vitest'

import { branchNameProblem } from '#src/index.ts'

describe('branchNameProblem', () => {
  it('accepts what git accepts', () => {
    for (const ok of ['main', 'release/v1.2', 'feat/a-b_c', 'ünï', 'a@b']) {
      expect(branchNameProblem(ok)).toBeUndefined()
    }
  })

  it('refuses what git refuses', () => {
    for (const bad of [
      '',
      'a b',
      '-x',
      '/x',
      'x/',
      'x.',
      'a..b',
      'a//b',
      'a@{b',
      '@',
      'a~b',
      'a^b',
      'a:b',
      'a?b',
      'a*b',
      'a[b',
      'a\\b',
      'a\tb',
      '.hidden',
      'a/.b',
      'x.lock',
      'a/x.lock/b',
    ]) {
      expect(branchNameProblem(bad)).toEqual(expect.any(String))
    }
  })
})
