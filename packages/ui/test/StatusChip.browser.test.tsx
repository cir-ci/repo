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
    await render(<StatusChip status="neutral">Expired</StatusChip>)
    const chip = page.getByText('Expired').element()
    expect(chip.textContent).toBe('Expired')
    expect(chip.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(page.getByRole('img', { name: 'Unchanged' }).elements()).toHaveLength(0)
  })
})
