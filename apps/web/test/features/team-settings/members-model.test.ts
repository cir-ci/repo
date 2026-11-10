import { describe, expect, it } from 'vitest'

import { addCandidates, addLabel, removalText } from '#features/team-settings/members-model.ts'
import { findTeams } from '#features/team-settings/teams-list.ts'
import { overview } from '#test/support/fixtures.ts'

const person = (id: string, name: string, email: string, role = 'member') => ({
  userId: id,
  role,
  user: { id, name, email },
})

describe('addCandidates', () => {
  const everyone = [
    person('u1', 'Michael Hazan', 'michael@acme.dev', 'owner'),
    person('u2', 'Omer Katz', 'omer@acme.dev'),
    person('u3', 'Noa Ben-Ari', 'noa@acme.dev'),
  ]

  it('leaves out who is in the team already', () => {
    expect(addCandidates(everyone, [{ id: 'u1' }], '').map((m) => m.userId)).toEqual(['u2', 'u3'])
  })

  it('matches the name or the email, ignoring case', () => {
    expect(addCandidates(everyone, [], 'NOA').map((m) => m.userId)).toEqual(['u3'])
    expect(addCandidates(everyone, [], 'omer@').map((m) => m.userId)).toEqual(['u2'])
    expect(addCandidates(everyone, [], 'nobody')).toEqual([])
  })
})

describe('the Members tab copy', () => {
  it('counts what Add will add', () => {
    expect(addLabel(1)).toBe('Add 1 member')
    expect(addLabel(3)).toBe('Add 3 members')
  })

  it('asks before leaving and before removing someone', () => {
    expect(removalText('web-app', { name: 'Ada', you: true })).toMatchObject({
      title: 'Leave web-app?',
      button: 'Leave team',
    })
    expect(removalText('web-app', { name: 'Dana Levi', you: false })).toMatchObject({
      title: 'Remove Dana Levi from web-app?',
      button: 'Remove',
    })
  })
})

describe('findTeams', () => {
  const teams = [overview('acme', 'web-app'), overview('acme', 'storybook')]

  it('finds by name or address, ignoring case', () => {
    expect(findTeams(teams, 'STORY').map((o) => o.team.slug)).toEqual(['storybook'])
    expect(findTeams(teams, 'acme/web').map((o) => o.team.slug)).toEqual(['web-app'])
    expect(findTeams(teams, '  ')).toHaveLength(2)
  })
})
