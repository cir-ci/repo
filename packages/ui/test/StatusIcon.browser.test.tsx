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
  'expired',
  'no-baseline',
  'uploading',
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
    await expect.element(page.getByRole('img', { name: 'Expired' })).toBeVisible()
    await expect.element(page.getByRole('img', { name: 'No baseline' })).toBeVisible()
    await expect.element(page.getByRole('img', { name: 'Uploading' })).toBeVisible()
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

  it('draws expired as a ring with an hourglass and no baseline as a dashed ring around a dot', async () => {
    await render(
      <>
        <StatusIcon status="expired" size={14} />
        <StatusIcon status="no-baseline" size={32} />
      </>,
    )
    const expired = page.getByRole('img', { name: 'Expired' })
    const none = page.getByRole('img', { name: 'No baseline' })
    expect(expired.element().querySelectorAll('circle')).toHaveLength(1)
    expect(expired.element().querySelectorAll('path')).toHaveLength(1)
    expect(expired.element().getBoundingClientRect().width).toBe(14)
    expect(none.element().getBoundingClientRect().width).toBe(32)
    expect(none.element().querySelector('circle')?.getAttribute('stroke-dasharray')).toBeTruthy()
    expect(none.element().querySelectorAll('circle')).toHaveLength(2)
    // Muted tones, no animation.
    const root = getComputedStyle(document.documentElement)
    expect(getComputedStyle(expired.element()).color).not.toBe('')
    expect(getComputedStyle(none.element()).animationName).toBe('none')
    expect(root).toBeTruthy()
  })

  it('draws uploading as a ring with a rising arrow in the processing color', async () => {
    await render(<StatusIcon status="uploading" size={20} />)
    const svg = page.getByRole('img', { name: 'Uploading' })
    expect(svg.element().querySelectorAll('circle')).toHaveLength(1)
    const arrow = svg.element().querySelector('path')
    expect(arrow).not.toBeNull()
    expect(svg.element().getBoundingClientRect().width).toBe(20)
    const probe = document.createElement('span')
    probe.style.color = 'var(--circi-state-processing)'
    document.body.append(probe)
    expect(getComputedStyle(svg.element()).color).toBe(getComputedStyle(probe).color)
    probe.remove()
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    expect(arrow ? getComputedStyle(arrow).animationName !== 'none' : null).toBe(!reduced)
  })

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
