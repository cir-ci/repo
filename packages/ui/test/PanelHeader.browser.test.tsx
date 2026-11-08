import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { PanelHeader } from '../src/index.ts'

describe('PanelHeader', () => {
  it('is a header at least 44px high with the title left and actions right', async () => {
    await render(
      <PanelHeader actions={<button type="button">Approve</button>}>
        <span>web-app / #148</span>
      </PanelHeader>,
    )
    const header = page.getByRole('banner').element()
    expect(header.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    const title = page.getByText('web-app / #148').element()
    const action = page.getByRole('button', { name: 'Approve' }).element()
    expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(
      action.getBoundingClientRect().left,
    )
  })
})
