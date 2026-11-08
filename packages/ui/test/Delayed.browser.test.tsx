import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import { Delayed, ListSkeleton } from '#src/index.ts'

describe('Delayed', () => {
  it('reserves its content at once but only shows it after the delay', async () => {
    const { container } = await render(
      <Delayed delayMs={400}>
        <ListSkeleton rows={2} />
      </Delayed>,
    )
    const wrapper = container.firstElementChild
    if (!(wrapper instanceof HTMLElement)) throw new Error('no wrapper')
    expect(wrapper.getAttribute('aria-hidden')).toBe('true')
    // In the layout (it takes space) but invisible.
    expect(wrapper.getBoundingClientRect().height).toBeGreaterThan(0)
    expect(getComputedStyle(wrapper).opacity).toBe('0')
    await expect.poll(() => getComputedStyle(wrapper).opacity, { timeout: 2000 }).toBe('1')
  })

  it('waits 300ms by default', async () => {
    const { container } = await render(<Delayed>x</Delayed>)
    const wrapper = container.firstElementChild
    if (!(wrapper instanceof HTMLElement)) throw new Error('no wrapper')
    expect(getComputedStyle(wrapper).animationDelay).toBe('0.3s')
  })
})
