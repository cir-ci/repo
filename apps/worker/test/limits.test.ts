import { describe, expect, it } from 'vitest'

import { currentLimits } from '#src/limits.ts'

describe('currentLimits', () => {
  it('uses the plain values and their defaults without a settings reader', async () => {
    expect(await currentLimits({})).toEqual({
      uploadTimeoutMinutes: 60,
      gcGraceHours: 24,
      jobRetentionDays: 14,
      webhookTimeoutMs: 0,
    })
    expect(await currentLimits({ gcGraceHours: 5 })).toMatchObject({ gcGraceHours: 5 })
  })

  it('reads the settings at every call, so a change applies to the next sweep or job', async () => {
    let hours = 24
    const limits = async () => ({
      uploadTimeoutMinutes: 1,
      gcGraceHours: hours,
      jobRetentionDays: 1,
      webhookTimeoutMs: 1000,
    })
    expect((await currentLimits({ limits })).gcGraceHours).toBe(24)
    hours = 96
    expect((await currentLimits({ limits, gcGraceHours: 5 })).gcGraceHours).toBe(96)
  })
})
