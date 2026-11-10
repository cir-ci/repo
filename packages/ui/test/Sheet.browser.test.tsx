import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { Button, Sheet } from '#src/index.ts'

function Harness({ size }: { size?: Sheet.Props['size'] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open</Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Screenshots"
        {...(size ? { size } : {})}
        footer={<Button variant="primary">Done</Button>}
      >
        <a href="/one">One</a>
      </Sheet>
    </>
  )
}

afterEach(async () => {
  await page.viewport(1000, 700)
})

describe('Sheet', () => {
  it('is a modal dialog named by its title that rises from the bottom edge, full width', async () => {
    await page.viewport(390, 844)
    await render(<Harness />)
    await page.getByRole('button', { name: 'Open' }).click()
    const sheet = page.getByRole('dialog', { name: 'Screenshots' })
    await expect.element(sheet).toBeVisible()
    await expect.poll(() => Math.round(sheet.element().getBoundingClientRect().bottom)).toBe(844)
    const box = sheet.element().getBoundingClientRect()
    expect(Math.round(box.width)).toBe(390)
    const style = getComputedStyle(sheet.element())
    expect(Number.parseFloat(style.borderTopLeftRadius)).toBeGreaterThan(0)
    expect(style.borderBottomLeftRadius).toBe('0px')
    await expect.element(sheet.getByRole('link', { name: 'One' })).toBeVisible()
  })

  it('has a 44px Close and closes on it and on Escape', async () => {
    await page.viewport(390, 844)
    await render(<Harness />)
    await page.getByRole('button', { name: 'Open' }).click()
    const close = page.getByRole('dialog').getByRole('button', { name: 'Close' })
    expect(close.element().getBoundingClientRect().width).toBeGreaterThanOrEqual(44)
    expect(close.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    await close.click()
    await expect.poll(() => page.getByRole('dialog').elements().length).toBe(0)
    await expect.element(page.getByRole('button', { name: 'Open' })).toHaveFocus()
    await page.getByRole('button', { name: 'Open' }).click()
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => page.getByRole('dialog').elements().length).toBe(0)
  })

  it('pins its footer under the scrolling body', async () => {
    await page.viewport(390, 844)
    await render(<Harness />)
    await page.getByRole('button', { name: 'Open' }).click()
    const sheet = page.getByRole('dialog')
    const done = sheet.getByRole('button', { name: 'Done' })
    await expect.element(done).toBeVisible()
    await expect
      .poll(() => Math.round(done.element().getBoundingClientRect().bottom))
      .toBeLessThanOrEqual(844)
  })

  it('fills the screen with size full', async () => {
    await page.viewport(390, 844)
    await render(<Harness size="full" />)
    await page.getByRole('button', { name: 'Open' }).click()
    const sheet = page.getByRole('dialog')
    await expect.poll(() => Math.round(sheet.element().getBoundingClientRect().top)).toBe(0)
    expect(Math.round(sheet.element().getBoundingClientRect().height)).toBe(844)
  })
})
