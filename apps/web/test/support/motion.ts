/// <reference types="@vitest/browser-playwright" />
import { onTestFinished } from 'vitest'
import { cdp } from 'vitest/browser'

/**
 * The browser the component tests run in prefers reduced motion (vitest.config.ts), so a
 * transition ends the moment it starts. A test of the motion itself calls this first: the page
 * behaves as for someone who has no such preference until the test is over.
 */
export async function emulateMotion(): Promise<void> {
  const session = cdp()
  await session.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  })
  onTestFinished(async () => {
    await session.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    })
  })
}
