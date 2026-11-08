import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import { ListSkeleton, Skeleton } from '#src/index.ts'

describe('Skeleton', () => {
  it('is visible at once, hidden from assistive tech, and the size given', async () => {
    const { container } = await render(<Skeleton width={120} height={16} />)
    const bar = container.querySelector('span')
    expect(bar?.getAttribute('aria-hidden')).toBe('true')
    const style = getComputedStyle(bar ?? container)
    expect([style.width, style.height, style.opacity]).toEqual(['120px', '16px', '1'])
  })

  it('ListSkeleton draws rows of 44px', async () => {
    const { container } = await render(<ListSkeleton rows={3} />)
    const rows = container.querySelectorAll('[data-slot="skeleton-row"]')
    expect(rows).toHaveLength(3)
    expect(getComputedStyle(rows[0] ?? container).height).toBe('44px')
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true')
  })
})
