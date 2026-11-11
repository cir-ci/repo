import { describe, expect, it } from 'vitest'

import {
  branchToSet,
  CI_EXAMPLES,
  gateNote,
  repoChoices,
  repoHelp,
  slugify,
} from '#features/projects/new-project.ts'

const ctx = { token: 'circi_secret123', project: 'acme/web-app', apiUrl: 'https://ci.acme.io' }

describe('slugify', () => {
  it('makes an address from a name', () => {
    expect(slugify('Web App')).toBe('web-app')
    expect(slugify('  checkout_flows!! ')).toBe('checkout-flows')
  })
  it('never returns an empty address', () => {
    expect(slugify('')).toBe('project')
    expect(slugify('!!!')).toBe('project')
  })
})

describe('branchToSet', () => {
  it('only sends a branch that differs from the default', () => {
    expect(branchToSet('main')).toBeUndefined()
    expect(branchToSet('  ')).toBeUndefined()
    expect(branchToSet(' develop ')).toBe('develop')
  })
})

describe('CI examples', () => {
  it('has the five systems of the docs, in order', () => {
    expect(CI_EXAMPLES.map((e) => e.label)).toEqual([
      'GitHub Actions',
      'GitLab CI',
      'Bitbucket Pipelines',
      'Jenkins',
      'Other',
    ])
  })
  it('names the project and this instance in every example', () => {
    for (const example of CI_EXAMPLES) {
      const text = example.snippet(ctx)
      expect(text).toContain('acme/web-app')
      expect(text).toContain('npx circi upload ./screenshots --wait')
    }
    expect(CI_EXAMPLES[0]?.snippet(ctx)).toContain('CIRCI_API_URL: https://ci.acme.io')
    expect(CI_EXAMPLES[3]?.snippet(ctx)).toContain('CIRCI_API_URL=https://ci.acme.io')
  })
  it('writes the token only where there is no secret store: Other', () => {
    for (const example of CI_EXAMPLES) {
      const has = example.snippet(ctx).includes('circi_secret123')
      expect(has).toBe(example.key === 'other')
    }
    expect(CI_EXAMPLES[4]?.snippet(ctx)).toContain('export CIRCI_TOKEN=circi_secret123')
  })
})

describe('notes', () => {
  it('says what gates the merge, with and without a repository', () => {
    expect(gateNote(true)).toContain('check on the pull request')
    expect(gateNote(false)).toContain('CI job is the merge gate')
    expect(repoHelp(true)).toContain('posts a check')
    expect(repoHelp(false)).toContain('CLI exit code')
  })
})

describe('repoChoices', () => {
  it('lists the targets of every integration, with the integration they belong to', () => {
    const choices = repoChoices([
      {
        id: 'i1',
        targets: [
          { id: 'r1', name: 'acme/web' },
          { id: 'r2', name: 'acme/api', label: 'acme/api (private)' },
        ],
      },
      { id: 'i2', targets: [{ id: 'r1', name: 'other/web' }] },
    ])
    expect(choices.map((c) => [c.integration, c.ref, c.name])).toEqual([
      ['i1', 'r1', 'acme/web'],
      ['i1', 'r2', 'acme/api (private)'],
      ['i2', 'r1', 'other/web'],
    ])
    expect(new Set(choices.map((c) => c.value)).size).toBe(3)
  })
})
