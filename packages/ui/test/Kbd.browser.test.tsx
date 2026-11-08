import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { Kbd } from '#src/index.ts'

describe('Kbd', () => {
  it('is a kbd element, 18px high, in the mono face', async () => {
    await render(<Kbd>⌘K</Kbd>)
    const el = page.getByText('⌘K').element()
    expect(el.tagName).toBe('KBD')
    expect(el.getBoundingClientRect().height).toBe(18)
    expect(getComputedStyle(el).fontSize).toBe('11px')
  })
})
