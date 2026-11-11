import { ForbiddenError, NotFoundError } from '@circi/core'
import { describe, expect, it } from 'vitest'

import {
  type Actor,
  assertAllowed,
  canAdjustCommentRegion,
  canDeleteWorkspace,
  canManageWorkspace,
  canReadProject,
  canAddProjectMembers,
  canReadWorkspace,
  canRemoveProjectMember,
  canSeeProject,
  canWriteProject,
  isInstanceAdmin,
  isWorkspaceOwner,
} from '#src/index.ts'

const actor = (role: string | undefined, instanceAdmin = false, projectMember = true): Actor => ({
  userId: 'u1',
  instanceAdmin,
  role,
  projectMember,
})

describe('workspace and project policies', () => {
  it('lets any member read', () => {
    for (const role of ['owner', 'admin', 'member']) {
      expect(canReadWorkspace(actor(role))).toEqual({ allow: true })
      expect(canReadProject(actor(role))).toEqual({ allow: true })
    }
  })

  it('denies a non-member as not-member, before looking at any role', () => {
    const none = actor(undefined, true)
    for (const policy of [
      canReadWorkspace,
      canReadProject,
      canManageWorkspace,
      canWriteProject,
      canDeleteWorkspace,
    ]) {
      expect(policy(none)).toEqual({ allow: false, reason: 'not-member' })
    }
  })

  it('lets only owners and admins manage', () => {
    for (const policy of [canManageWorkspace, canWriteProject]) {
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

describe('project visibility and members', () => {
  it('shows a project to its members and to owners and admins, and hides it from other members', () => {
    expect(canSeeProject(actor('member', false, true))).toEqual({ allow: true })
    expect(canSeeProject(actor('owner', false, false))).toEqual({ allow: true })
    expect(canSeeProject(actor('admin', false, false))).toEqual({ allow: true })
    expect(canSeeProject(actor('member', false, false))).toEqual({
      allow: false,
      reason: 'not-member',
    })
    expect(canReadProject(actor('member', false, false))).toEqual({
      allow: false,
      reason: 'not-member',
    })
    expect(canSeeProject({ userId: 'u1', instanceAdmin: false, role: 'member' })).toEqual({
      allow: false,
      reason: 'not-member',
    })
  })

  it('answers a member of a hidden project as for a project that does not exist, even on a manage check', () => {
    const hidden = actor('member', false, false)
    expect(canWriteProject(hidden)).toEqual({ allow: false, reason: 'not-member' })
    expect(canAddProjectMembers(hidden)).toEqual({ allow: false, reason: 'not-member' })
    expect(canRemoveProjectMember(hidden, 'u1')).toEqual({ allow: false, reason: 'not-member' })
  })

  it('lets owners and admins add anyone and remove anyone; members only leave', () => {
    for (const role of ['owner', 'admin']) {
      expect(canAddProjectMembers(actor(role, false, false))).toEqual({ allow: true })
      expect(canRemoveProjectMember(actor(role, false, false), 'someone-else')).toEqual({
        allow: true,
      })
    }
    expect(canAddProjectMembers(actor('member'))).toEqual({ allow: false, reason: 'not-manager' })
    expect(canRemoveProjectMember(actor('member'), 'u1')).toEqual({ allow: true })
    expect(canRemoveProjectMember(actor('member'), 'u2')).toEqual({
      allow: false,
      reason: 'not-manager',
    })
  })
})

describe('assertAllowed', () => {
  const messages = { notFound: 'Project not found', forbidden: 'Only owners and admins' }

  it('does nothing when allowed', () => {
    expect(() => assertAllowed(canWriteProject(actor('owner')), messages)).not.toThrow()
  })

  it('throws NotFoundError (404 semantics) for a non-member, even on a manage check', () => {
    expect(() => assertAllowed(canWriteProject(actor(undefined)), messages)).toThrow(
      new NotFoundError('Project not found'),
    )
    expect(() => assertAllowed(canWriteProject(actor(undefined)), messages)).toThrow(NotFoundError)
  })

  it('throws ForbiddenError (403 semantics) for a member without the role', () => {
    expect(() => assertAllowed(canWriteProject(actor('member')), messages)).toThrow(ForbiddenError)
    expect(() => assertAllowed(canWriteProject(actor('member')), messages)).toThrow(
      'Only owners and admins',
    )
  })
})

describe('canAdjustCommentRegion', () => {
  it('lets the author only, owners and admins included', () => {
    expect(canAdjustCommentRegion(actor('member'), 'u1')).toEqual({ allow: true })
    expect(canAdjustCommentRegion(actor('owner'), 'u2')).toEqual({
      allow: false,
      reason: 'not-author',
    })
    expect(canAdjustCommentRegion(actor('member'), null).allow).toBe(false)
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
