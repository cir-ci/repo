import { Dialog } from '@circi/ui'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { onDemand } from '#lib/on-demand.tsx'
import { renderPage } from '#test/support/render.tsx'

function Sample({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Sample"
      actions={
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      }
    >
      <input aria-label="Name" />
    </Dialog>
  )
}

const LazyDialog = onDemand(
  () => Promise.resolve({ Sample }),
  (m) => m.Sample,
)

const SlowDialog = onDemand(
  () =>
    new Promise<{ Sample: typeof Sample }>((resolve) => {
      setTimeout(() => resolve({ Sample }), 150)
    }),
  (m) => m.Sample,
)

function Opener({ Lazy }: { Lazy: typeof LazyDialog }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open sample
      </button>
      <Lazy open={open} onClose={() => setOpen(false)} />
    </>
  )
}

/** The dialog is only mounted while it is open, like the instance settings' provider dialog. */
function Conditional() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open sample
      </button>
      {open ? <Sample open onClose={() => setOpen(false)} /> : null}
    </>
  )
}

const dialog = () => page.getByRole('dialog', { name: 'Sample' })

describe('a dialog that loads when first opened', () => {
  it.each([
    ['at once', LazyDialog],
    ['after a wait', SlowDialog],
  ])('gives focus back to its opener with Escape, loaded %s', async (_when, Lazy) => {
    await renderPage(<Opener Lazy={Lazy} />)
    const opener = page.getByRole('button', { name: 'Open sample' })
    opener.element().focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(dialog()).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog()).not.toBeInTheDocument()
    await expect.poll(() => document.activeElement).toBe(opener.element())
  })

  it('gives focus back to its opener with Cancel', async () => {
    await renderPage(<Opener Lazy={SlowDialog} />)
    const opener = page.getByRole('button', { name: 'Open sample' })
    await userEvent.click(opener)
    await expect.element(dialog()).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'Cancel' }))
    await expect.element(dialog()).not.toBeInTheDocument()
    await expect.poll(() => document.activeElement).toBe(opener.element())
  })
})

describe('a dialog unmounted when it closes', () => {
  it.each([['Escape'], ['Cancel']])('gives focus back to its opener with %s', async (how) => {
    await renderPage(<Conditional />)
    const opener = page.getByRole('button', { name: 'Open sample' })
    opener.element().focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(dialog()).toBeVisible()
    if (how === 'Escape') await userEvent.keyboard('{Escape}')
    else await userEvent.click(page.getByRole('button', { name: 'Cancel' }))
    await expect.element(dialog()).not.toBeInTheDocument()
    await expect.poll(() => document.activeElement).toBe(opener.element())
  })
})
