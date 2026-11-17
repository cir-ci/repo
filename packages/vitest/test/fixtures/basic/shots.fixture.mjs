import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

const color = import.meta.env['VITE_FIXTURE_COLOR'] ?? 'tomato'

describe('card', () => {
  it('renders', async () => {
    document.body.innerHTML = `<div data-testid="box" style="width:120px;height:60px;background:${color}"></div>`
    await expect.element(page.getByTestId('box')).toMatchScreenshot('box')
    await expect(page.getByTestId('box')).toMatchScreenshot()
  })
})
