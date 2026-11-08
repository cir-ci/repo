import { describe, expect, it } from 'vitest'

import { deleteConfirmed, deletePhrase } from '#features/teams/delete-team.ts'

describe('deleting a team', () => {
  it('asks for workspace/team typed back, ignoring surrounding spaces but not case', () => {
    const phrase = deletePhrase('acme', 'web')
    expect(phrase).toBe('acme/web')
    expect(deleteConfirmed(' acme/web ', phrase)).toBe(true)
    expect(deleteConfirmed('acme/Web', phrase)).toBe(false)
    expect(deleteConfirmed('web', phrase)).toBe(false)
    expect(deleteConfirmed('', phrase)).toBe(false)
  })
})
