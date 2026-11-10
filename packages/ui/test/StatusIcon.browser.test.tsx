import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { STATUS_LABEL, type Status, StatusIcon } from '#src/index.ts'

const STATUSES: Status[] = [
  'approved',
  'auto-approved',
  'needs-review',
  'processing',
  'failed',
  'rejected',
  'neutral',
  'added',
  'removed',
  'flaky',
]

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
    await expect.element(page.getByRole('img', { name: 'Auto-approved' })).toBeVisible()
    await expect.element(page.getByRole('img', { name: 'Needs review' })).toBeVisible()
    await expect.element(page.getByRole('img', { name: 'Processing' })).toBeVisible()
    await expect.element(page.getByRole('img', { name: 'Failed' })).toBeVisible()
    await expect.element(page.getByRole('img', { name: 'Rejected' })).toBeVisible()
    await expect.element(page.getByRole('img', { name: 'Unchanged' })).toBeVisible()
    await expect.element(page.getByRole('img', { name: 'Added' })).toBeVisible()
    await expect.element(page.getByRole('img', { name: 'Removed' })).toBeVisible()
    await expect.element(page.getByRole('img', { name: 'Flaky' })).toBeVisible()
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

  it('draws failed and rejected apart: a cross in crimson, a barred disc in rose', async () => {
    await render(
      <>
        <StatusIcon status="failed" />
        <StatusIcon status="rejected" />
      </>,
    )
    const failed = page.getByRole('img', { name: 'Failed' })
    const rejected = page.getByRole('img', { name: 'Rejected' })
    expect(failed.element().querySelector('path')?.getAttribute('d')).toContain('M4.7 4.7')
    expect(rejected.element().querySelector('path')?.getAttribute('d')).toBe('M3.9 7h6.2')
    expect(rejected.element().querySelector('path')?.getAttribute('transform')).toContain('rotate')
    const root = getComputedStyle(document.documentElement)
    const colourOf = (variable: string) => {
      const probe = document.createElement('span')
      probe.style.color = root.getPropertyValue(variable)
      document.body.append(probe)
      const colour = getComputedStyle(probe).color
      probe.remove()
      return colour
    }
    const failedColour = getComputedStyle(failed.element()).color
    const rejectedColour = getComputedStyle(rejected.element()).color
    expect(failedColour).toBe(colourOf('--circi-state-failed'))
    expect(rejectedColour).toBe(colourOf('--circi-state-rejected'))
    expect(failedColour).not.toBe(rejectedColour)
  })

  it.each(['added', 'removed', 'flaky'] as const)(
    'draws %s as a ring with a mark',
    async (status) => {
      await render(<StatusIcon status={status} />)
      const svg = page.getByRole('img', { name: STATUS_LABEL[status] })
      await expect.element(svg).toHaveAttribute('data-status', status)
      expect(svg.element().querySelectorAll('circle')).toHaveLength(1)
      expect(svg.element().querySelectorAll('path')).toHaveLength(1)
    },
  )

  it('draws processing as eight arcs that swell one after the other, clockwise', async () => {
    await render(<StatusIcon status="processing" />)
    const icon = page.getByRole('img', { name: 'Processing' }).element()
    const arcs = [...icon.querySelectorAll('path')]
    expect(arcs).toHaveLength(8)
    const styles = arcs.map((arc) => getComputedStyle(arc))
    // The same loop for each, started a step later round the ring.
    expect(new Set(styles.map((s) => s.animationName)).size).toBe(1)
    expect(styles[0]?.animationName).not.toBe('none')
    expect(styles[0]?.animationIterationCount).toBe('infinite')
    const delays = styles.map((s) => Number.parseFloat(s.animationDelay))
    expect(delays).toEqual(delays.toSorted((a, b) => a - b))
    expect(new Set(delays).size).toBe(8)
  })

  it('takes a size and a custom label', async () => {
    await render(<StatusIcon status="approved" size={32} label="Passed" />)
    const svg = page.getByRole('img', { name: 'Passed' })
    await expect.element(svg).toHaveAttribute('data-status', 'approved')
    expect(svg.element().getBoundingClientRect().width).toBe(32)
  })
})
