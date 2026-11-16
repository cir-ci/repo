import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { StatusChip } from '#src/index.ts'

describe('StatusChip', () => {
  it('shows the status word by default, next to its glyph', async () => {
    await render(<StatusChip status="needs-review" />)
    await expect.element(page.getByText('Needs review')).toBeVisible()
    await expect.element(page.getByRole('img', { name: 'Needs review' })).toBeVisible()
  })

  it('shows custom text and is 22px high', async () => {
    await render(<StatusChip status="approved">4 changed</StatusChip>)
    const chip = page.getByText('4 changed').element()
    expect(chip.getBoundingClientRect().height).toBe(22)
    // The text says it: the glyph is decoration, so the chip doesn't read "Approved 4 changed".
    expect(page.getByRole('img').elements()).toHaveLength(0)
  })

  it('does not read the glyph name before custom text ("Expired", not "Unchanged Expired")', async () => {
    await render(<StatusChip status="expired">Expired</StatusChip>)
    const chip = page.getByText('Expired').element()
    expect(chip.textContent).toBe('Expired')
    expect(chip.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(page.getByRole('img', { name: 'Expired' }).elements()).toHaveLength(0)
  })

  it('has a chip for uploading', async () => {
    await render(<StatusChip status="uploading" />)
    await expect.element(page.getByText('Uploading')).toBeVisible()
    await expect.element(page.getByRole('img', { name: 'Uploading' })).toBeVisible()
  })

  it('has chips for expired and no baseline', async () => {
    await render(
      <>
        <StatusChip status="expired" />
        <StatusChip status="no-baseline" />
      </>,
    )
    await expect.element(page.getByText('Expired')).toBeVisible()
    await expect.element(page.getByRole('img', { name: 'Expired' })).toBeVisible()
    await expect.element(page.getByText('No baseline')).toBeVisible()
    await expect.element(page.getByRole('img', { name: 'No baseline' })).toBeVisible()
  })
})

describe('StatusChip text colour', () => {
  it('uses the text variants of the state colours, never the glyph colour', async () => {
    await render(
      <>
        <StatusChip status="approved" />
        <StatusChip status="failed" />
        <StatusChip status="rejected" />
      </>,
    )
    const root = getComputedStyle(document.documentElement)
    const colourOf = (variable: string) => {
      const probe = document.createElement('span')
      probe.style.color = root.getPropertyValue(variable)
      document.body.append(probe)
      const colour = getComputedStyle(probe).color
      probe.remove()
      return colour
    }
    const approved = page.getByText('Approved').element()
    const failed = page.getByText('Failed').element()
    const rejected = page.getByText('Rejected').element()
    expect(getComputedStyle(approved).color).toBe(colourOf('--circi-state-approved-text'))
    expect(getComputedStyle(failed).color).toBe(colourOf('--circi-state-failed-text'))
    expect(getComputedStyle(rejected).color).toBe(colourOf('--circi-state-rejected-text'))
  })
})
