import { CirciTheme } from '@circi/ui'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { ErrorState } from '#lib/ErrorState.tsx'
import { HttpError } from '#lib/http.ts'

describe('ErrorState', () => {
  it('says "not found" in the page\'s own words for a 404', async () => {
    await render(
      <CirciTheme>
        <ErrorState error={new HttpError(404, 'nope')} notFound="This team doesn't exist" />
      </CirciTheme>,
    )
    await expect.element(page.getByText("This team doesn't exist")).toBeVisible()
  })

  it('shows the message and offers a retry for other errors', async () => {
    const onRetry = vi.fn<() => void>()
    await render(
      <CirciTheme>
        <ErrorState error={new Error('boom')} onRetry={onRetry} />
      </CirciTheme>,
    )
    await expect.element(page.getByText('boom')).toBeVisible()
    await page.getByRole('button', { name: 'Try again' }).click()
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('offers no retry when there is nothing to retry', async () => {
    await render(
      <CirciTheme>
        <ErrorState error={new Error('boom')} />
      </CirciTheme>,
    )
    expect(page.getByRole('button').elements()).toHaveLength(0)
  })
})
