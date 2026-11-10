import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { FindField } from '#lib/FindField.tsx'

describe('FindField', () => {
  it.each([260, 180])('fills its box with no gap on the right, %ipx wide', async (width) => {
    await render(
      <div style={{ width }}>
        <FindField noun="baselines" value="" onChange={() => {}} />
      </div>,
    )
    const input = page
      .getByRole('searchbox', { name: 'Find baselines' })
      .or(page.getByRole('textbox', { name: 'Find baselines' }))
    const box = input.element().closest('span')!.getBoundingClientRect()
    const field = input.element().getBoundingClientRect()
    expect(Math.round(field.right)).toBe(Math.round(box.right))
    expect(Math.round(box.width)).toBe(Math.min(width, 260))
  })
})
