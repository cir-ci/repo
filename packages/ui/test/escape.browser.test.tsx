import { MoreHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { Button, IconButton, Menu, Popover } from '#src/index.ts'

/**
 * Menu and Popover are plain wrappers: Escape and the focus that goes back to the trigger are Base
 * UI's, so one table shows both keep them. Dialog, Drawer and ImageDialog add behavior of their own
 * (a callback, a ScrollArea, a viewer) and keep their Escape tests.
 */
const WRAPPERS: [string, string, string, ReactNode][] = [
  [
    'Menu',
    'Row actions',
    'menu',
    <Menu
      key="menu"
      trigger={
        <IconButton label="Row actions">
          <MoreHorizontal />
        </IconButton>
      }
      items={[{ label: 'Account' }, { label: 'Theme' }]}
    />,
  ],
  [
    'Popover',
    'Project',
    'dialog',
    <Popover key="popover" trigger={<Button>Project</Button>} label="Switch project">
      <Button>First</Button>
    </Popover>,
  ],
]

describe.each(WRAPPERS)('%s', (_, triggerName, role, ui) => {
  it('closes on Escape and returns focus to the trigger', async () => {
    await render(ui)
    const trigger = page.getByRole('button', { name: triggerName })
    await trigger.click()
    await expect.element(page.getByRole(role)).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole(role)).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  })
})
