import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { STATUS_LABEL, type Status, StatusIcon } from '../src/index.ts'

const STATUSES: Status[] = ['approved', 'needs-review', 'processing', 'rejected', 'neutral']

describe('StatusIcon', () => {
  it('names every status for assistive tech', async () => {
    await render(
      <>
        {STATUSES.map((s) => (
          <StatusIcon key={s} status={s} />
        ))}
      </>,
    )
    await expect.element(page.getByRole('img', { name: 'Approved' })).toBeVisible()
    await expect.element(page.getByRole('img', { name: 'Needs review' })).toBeVisible()
    await expect.element(page.getByRole('img', { name: 'Processing' })).toBeVisible()
    await expect.element(page.getByRole('img', { name: 'Rejected' })).toBeVisible()
    await expect.element(page.getByRole('img', { name: 'No changes' })).toBeVisible()
  })

  it('has a different shape per status, not only a different colour', async () => {
    await render(
      <>
        {STATUSES.map((s) => (
          <StatusIcon key={s} status={s} />
        ))}
      </>,
    )
    const shapes = STATUSES.map(
      (s) => page.getByRole('img', { name: STATUS_LABEL[s] }).element().innerHTML,
    )
    expect(new Set(shapes).size).toBe(STATUSES.length)
  })

  it('takes a size and a custom label', async () => {
    await render(<StatusIcon status="approved" size={32} label="Passed" />)
    const svg = page.getByRole('img', { name: 'Passed' })
    await expect.element(svg).toHaveAttribute('data-status', 'approved')
    expect(svg.element().getBoundingClientRect().width).toBe(32)
  })
})
