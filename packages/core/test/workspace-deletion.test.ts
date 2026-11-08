import { describe, expect, it } from 'vitest'

import {
  isWorkspacePurgeDue,
  WORKSPACE_PURGE_DAYS,
  workspaceDaysLeft,
  workspacePurgeAt,
} from '../src/index.ts'

const deletedAt = new Date('2026-01-01T12:00:00Z')
const at = (ms: number) => new Date(deletedAt.getTime() + ms)
const DAY = 86_400_000

describe('workspace deletion', () => {
  it('purges 30 days after deletion', () => {
    expect(WORKSPACE_PURGE_DAYS).toBe(30)
    expect(workspacePurgeAt(deletedAt).toISOString()).toBe('2026-01-31T12:00:00.000Z')
  })

  it('is not due one millisecond before 30 days, and is due exactly at 30 days', () => {
    expect(isWorkspacePurgeDue(deletedAt, at(30 * DAY - 1))).toBe(false)
    expect(isWorkspacePurgeDue(deletedAt, at(30 * DAY))).toBe(true)
    expect(isWorkspacePurgeDue(deletedAt, at(31 * DAY))).toBe(true)
  })

  it('counts whole days left, rounded up, never below 0', () => {
    expect(workspaceDaysLeft(deletedAt, deletedAt)).toBe(30)
    expect(workspaceDaysLeft(deletedAt, at(1))).toBe(30)
    expect(workspaceDaysLeft(deletedAt, at(DAY))).toBe(29)
    expect(workspaceDaysLeft(deletedAt, at(29 * DAY))).toBe(1)
    expect(workspaceDaysLeft(deletedAt, at(30 * DAY - 1))).toBe(1)
    expect(workspaceDaysLeft(deletedAt, at(30 * DAY))).toBe(0)
    expect(workspaceDaysLeft(deletedAt, at(40 * DAY))).toBe(0)
  })
})
