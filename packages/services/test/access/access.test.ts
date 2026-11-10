import { ForbiddenError, NotFoundError } from '@circi/core'
import { describe, expect, it } from 'vitest'

import {
  type Actor,
  assertAllowed,
  canDeleteWorkspace,
  canManageWorkspace,
  canReadTeam,
  canAddTeamMembers,
  canReadWorkspace,
  canRemoveTeamMember,
  canSeeTeam,
  canWriteTeam,
  isInstanceAdmin,
  isWorkspaceOwner,
} from '#src/index.ts'

const actor = (role: string | undefined, instanceAdmin = false, teamMember = true): Actor => ({
  userId: 'u1',
  instanceAdmin,
  role,
  teamMember,
})

describe('workspace and team policies', () => {
  it('lets any member read', () => {
    for (const role of ['owner', 'admin', 'member']) {
      expect(canReadWorkspace(actor(role))).toEqual({ allow: true })
      expect(canReadTeam(actor(role))).toEqual({ allow: true })
    }
  })

  it('denies a non-member as not-member, before looking at any role', () => {
    const none = actor(undefined, true)
    for (const policy of [
      canReadWorkspace,
      canReadTeam,
      canManageWorkspace,
      canWriteTeam,
      canDeleteWorkspace,
    ]) {
      expect(policy(none)).toEqual({ allow: false, reason: 'not-member' })
    }
  })

  it('lets only owners and admins manage', () => {
    for (const policy of [canManageWorkspace, canWriteTeam]) {
      expect(policy(actor('owner'))).toEqual({ allow: true })
      expect(policy(actor('admin'))).toEqual({ allow: true })
      expect(policy(actor('member'))).toEqual({ allow: false, reason: 'not-manager' })
    }
  })

  it('lets only an owner delete', () => {
    expect(canDeleteWorkspace(actor('owner'))).toEqual({ allow: true })
    expect(canDeleteWorkspace(actor('admin'))).toEqual({ allow: false, reason: 'not-owner' })
    expect(canDeleteWorkspace(actor('member'))).toEqual({ allow: false, reason: 'not-owner' })
  })

  it('decides instance admins on the flag alone', () => {
    expect(isInstanceAdmin(actor('member', true))).toEqual({ allow: true })
    expect(isInstanceAdmin(actor('owner'))).toEqual({ allow: false, reason: 'not-instance-admin' })
  })
})

describe('team visibility and members', () => {
  it('shows a team to its members and to owners and admins, and hides it from other members', () => {
    expect(canSeeTeam(actor('member', false, true))).toEqual({ allow: true })
    expect(canSeeTeam(actor('owner', false, false))).toEqual({ allow: true })
    expect(canSeeTeam(actor('admin', false, false))).toEqual({ allow: true })
    expect(canSeeTeam(actor('member', false, false))).toEqual({
      allow: false,
      reason: 'not-member',
    })
    expect(canReadTeam(actor('member', false, false))).toEqual({
      allow: false,
      reason: 'not-member',
    })
    expect(canSeeTeam({ userId: 'u1', instanceAdmin: false, role: 'member' })).toEqual({
      allow: false,
      reason: 'not-member',
    })
  })

  it('answers a member of a hidden team as for a team that does not exist, even on a manage check', () => {
    const hidden = actor('member', false, false)
    expect(canWriteTeam(hidden)).toEqual({ allow: false, reason: 'not-member' })
    expect(canAddTeamMembers(hidden)).toEqual({ allow: false, reason: 'not-member' })
    expect(canRemoveTeamMember(hidden, 'u1')).toEqual({ allow: false, reason: 'not-member' })
  })

  it('lets owners and admins add anyone and remove anyone; members only leave', () => {
    for (const role of ['owner', 'admin']) {
      expect(canAddTeamMembers(actor(role, false, false))).toEqual({ allow: true })
      expect(canRemoveTeamMember(actor(role, false, false), 'someone-else')).toEqual({
        allow: true,
      })
    }
    expect(canAddTeamMembers(actor('member'))).toEqual({ allow: false, reason: 'not-manager' })
    expect(canRemoveTeamMember(actor('member'), 'u1')).toEqual({ allow: true })
    expect(canRemoveTeamMember(actor('member'), 'u2')).toEqual({
      allow: false,
      reason: 'not-manager',
    })
  })
})

describe('assertAllowed', () => {
  const messages = { notFound: 'Team not found', forbidden: 'Only owners and admins' }

  it('does nothing when allowed', () => {
    expect(() => assertAllowed(canWriteTeam(actor('owner')), messages)).not.toThrow()
  })

  it('throws NotFoundError (404 semantics) for a non-member, even on a manage check', () => {
    expect(() => assertAllowed(canWriteTeam(actor(undefined)), messages)).toThrow(
      new NotFoundError('Team not found'),
    )
    expect(() => assertAllowed(canWriteTeam(actor(undefined)), messages)).toThrow(NotFoundError)
  })

  it('throws ForbiddenError (403 semantics) for a member without the role', () => {
    expect(() => assertAllowed(canWriteTeam(actor('member')), messages)).toThrow(ForbiddenError)
    expect(() => assertAllowed(canWriteTeam(actor('member')), messages)).toThrow(
      'Only owners and admins',
    )
  })
})

describe('isWorkspaceOwner', () => {
  it('is true for owners only', () => {
    expect(isWorkspaceOwner(actor('owner'))).toBe(true)
    expect(isWorkspaceOwner(actor('admin'))).toBe(false)
    expect(isWorkspaceOwner(actor('member'))).toBe(false)
    expect(isWorkspaceOwner(actor(undefined))).toBe(false)
  })
})
