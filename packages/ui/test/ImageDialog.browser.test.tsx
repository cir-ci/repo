import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { EnlargeTrigger, ImageDialog } from '#src/index.ts'

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

const IMAGES: ImageDialog.Image[] = [
  { src: PIXEL, caption: 'Baseline · build #1 on main' },
  { src: PIXEL, caption: 'This build · a0f30cf' },
]

function Harness(props: { images?: ImageDialog.Image[] }) {
  const [at, setAt] = useState<number | null>(null)
  return (
    <>
      <EnlargeTrigger label="Enlarge this build" onClick={() => setAt(1)}>
        <img src={PIXEL} alt="" width={200} height={100} />
      </EnlargeTrigger>
      <ImageDialog
        images={props.images ?? IMAGES}
        open={at !== null}
        index={at ?? 0}
        onIndexChange={setAt}
        onOpenChange={(open) => {
          if (!open) setAt(null)
        }}
      />
    </>
  )
}

const trigger = () => page.getByRole('button', { name: 'Enlarge this build' })

describe('ImageDialog', () => {
  it('opens from the trigger with the image and its caption, at most 960px wide', async () => {
    await page.viewport(1200, 800)
    await render(<Harness />)
    await trigger().click()
    const dialog = page.getByRole('dialog', { name: 'This build · a0f30cf' })
    await expect.element(dialog).toBeVisible()
    await expect.element(dialog.getByRole('img')).toBeVisible()
    expect(getComputedStyle(dialog.element()).width).toBe('960px')
    await expect
      .element(dialog.getByRole('link', { name: 'Open full size' }))
      .toHaveAttribute('target', '_blank')
  })

  it('switches between the images with ← and →, and wraps', async () => {
    await render(<Harness />)
    await trigger().click()
    await expect.element(page.getByRole('dialog', { name: 'This build · a0f30cf' })).toBeVisible()
    await userEvent.keyboard('{ArrowLeft}')
    await expect
      .element(page.getByRole('dialog', { name: 'Baseline · build #1 on main' }))
      .toBeVisible()
    await userEvent.keyboard('{ArrowLeft}')
    await expect.element(page.getByRole('dialog', { name: 'This build · a0f30cf' })).toBeVisible()
    await userEvent.keyboard('{ArrowRight}')
    await expect
      .element(page.getByRole('dialog', { name: 'Baseline · build #1 on main' }))
      .toBeVisible()
  })

  it('switches with its buttons', async () => {
    await render(<Harness />)
    await trigger().click()
    await page.getByRole('button', { name: 'Previous image' }).click()
    await expect
      .element(page.getByRole('dialog', { name: 'Baseline · build #1 on main' }))
      .toBeVisible()
    await page.getByRole('button', { name: 'Next image' }).click()
    await expect.element(page.getByRole('dialog', { name: 'This build · a0f30cf' })).toBeVisible()
  })

  it('has no switching controls for a single image', async () => {
    await render(<Harness images={IMAGES.slice(1)} />)
    await trigger().click()
    await expect.element(page.getByRole('dialog')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Next image' })).not.toBeInTheDocument()
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    await render(<Harness />)
    await trigger().click()
    await expect.element(page.getByRole('dialog')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    await expect.element(trigger()).toHaveFocus()
  })

  it('closes with its close button', async () => {
    await render(<Harness />)
    await trigger().click()
    await page.getByRole('button', { name: 'Close' }).click()
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    await expect.element(trigger()).toHaveFocus()
  })

  it('closes on a click on the scrim', async () => {
    await page.viewport(1200, 800)
    await render(<Harness />)
    await trigger().click()
    await expect.element(page.getByRole('dialog')).toBeVisible()
    // The viewport layer around the popup is what a click on the scrim lands on.
    const viewport = page.getByRole('dialog').element().parentElement!
    await page.elementLocator(viewport).click({ position: { x: 5, y: 5 } })
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps the image inside the viewport', async () => {
    await page.viewport(800, 500)
    await render(
      <Harness
        images={[
          {
            src: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="4000"/>')}`,
            caption: 'Tall',
          },
        ]}
      />,
    )
    await trigger().click()
    const img = page.getByRole('dialog').getByRole('img').element()
    await expect.poll(() => img.getBoundingClientRect().height).toBeLessThanOrEqual(500)
    expect(img.getBoundingClientRect().width).toBeLessThanOrEqual(800)
  })
})
