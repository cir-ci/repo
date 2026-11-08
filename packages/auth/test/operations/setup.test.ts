import { describe, expect, it } from 'vitest'

import { isSetupCode, setupCode } from '#src/index.ts'

describe('setup code', () => {
  it('is stable for one secret and differs between secrets', () => {
    expect(setupCode('secret-one-that-is-long')).toBe(setupCode('secret-one-that-is-long'))
    expect(setupCode('secret-one-that-is-long')).not.toBe(setupCode('secret-two-that-is-long'))
  })
  it('accepts only the exact code', () => {
    const code = setupCode('secret-one-that-is-long')
    expect(isSetupCode('secret-one-that-is-long', ` ${code} `)).toBe(true)
    expect(isSetupCode('secret-one-that-is-long', code.slice(1))).toBe(false)
    expect(isSetupCode('secret-one-that-is-long', '')).toBe(false)
    expect(isSetupCode('secret-two-that-is-long', code)).toBe(false)
  })
})
