import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { settingsSections } from '#features/command/settings.ts'

const ids = () =>
  settingsSections({ workspace: undefined, canManage: false, instanceAdmin: false }).map(
    (s) => s.id,
  )

describe('the command menu on a phone', () => {
  it('lists the Keyboard shortcuts page on a desktop and leaves it out on a phone', async () => {
    await page.viewport(1280, 800)
    await expect.poll(() => ids()).toContain('shortcuts')
    await page.viewport(390, 844)
    expect(ids()).not.toContain('shortcuts')
    expect(ids()).toContain('appearance')
  })
})
