import { describe, expect, it } from 'vitest'

import { emulateMotion } from './support/motion.ts'

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

describe('the test browser', () => {
  it('prefers reduced motion, so no test waits out a transition', () => {
    expect(reduced()).toBe(true)
  })

  it('has no such preference for a test that asks for the motion itself', async () => {
    await emulateMotion()
    expect(reduced()).toBe(false)
  })

  it('goes back to reduced motion after that test', () => {
    expect(reduced()).toBe(true)
  })
})
