import { expect, it } from 'vitest'

import { expectConsoleError } from './console-guard.ts'

it('lets a test that expects an error print it', () => {
  expectConsoleError(/the expected one/)
  console.error('the expected one')
  expect(true).toBe(true)
})
