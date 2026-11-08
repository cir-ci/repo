import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { Button, Drawer } from '#src/index.ts'

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Menu</Button>
      <Drawer open={open} onOpenChange={setOpen} title="Navigation">
        <a href="/projects">Projects</a>
      </Drawer>
    </>
  )
}

describe('Drawer', () => {
  it('is a modal dialog named by its title, in a portal, holding its content', async () => {
    await page.viewport(390, 700)
    const { container } = await render(<Harness />)
    expect(page.getByRole('dialog').elements()).toHaveLength(0)
    await page.getByRole('button', { name: 'Menu' }).click()
    const drawer = page.getByRole('dialog', { name: 'Navigation' })
    await expect.element(drawer).toBeVisible()
    await expect
      .element(drawer)
      .toContainElement(page.getByRole('link', { name: 'Projects' }).element())
    expect(container.contains(drawer.element())).toBe(false)
  })

  it('slides in from the left edge and is at most the viewport minus 48px wide', async () => {
    await page.viewport(390, 700)
    await render(<Harness />)
    await page.getByRole('button', { name: 'Menu' }).click()
    const drawer = page.getByRole('dialog', { name: 'Navigation' })
    await expect.element(drawer).toBeVisible()
    await expect.poll(() => Math.round(drawer.element().getBoundingClientRect().left)).toBe(0)
    const rect = drawer.element().getBoundingClientRect()
    expect(rect.width).toBeLessThanOrEqual(280)
    expect(rect.width).toBeLessThanOrEqual(390 - 48)
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    await page.viewport(390, 700)
    await render(<Harness />)
    const trigger = page.getByRole('button', { name: 'Menu' })
    await trigger.click()
    await expect.element(page.getByRole('dialog', { name: 'Navigation' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => page.getByRole('dialog').elements().length).toBe(0)
    await expect.element(trigger).toHaveFocus()
  })
})
