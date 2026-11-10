import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { HttpError } from '#lib/http.ts'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'
import { renderPage } from '#test/support/render.tsx'

const idle = () => undefined

describe('QueryBoundary', () => {
  it('renders the data once it is there', async () => {
    await renderPage(
      <QueryBoundary query={{ data: ['a', 'b'], error: null, refetch: idle }}>
        {(rows) => <p>{rows.length} rows</p>}
      </QueryBoundary>,
    )
    await expect.element(page.getByText('2 rows')).toBeVisible()
  })

  it('shows the skeleton, not the children, while there is no data', async () => {
    const children = vi.fn<(data: string) => string>(() => 'loaded')
    await renderPage(
      <QueryBoundary query={{ data: undefined, error: null, refetch: idle }}>
        {children}
      </QueryBoundary>,
    )
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(children).not.toHaveBeenCalled()
    expect(page.getByText('loaded').elements()).toHaveLength(0)
  })

  it('shows the error with a retry that refetches, even when stale data is present', async () => {
    const refetch = vi.fn<() => unknown>()
    await renderPage(
      <QueryBoundary query={{ data: 'stale', error: new Error('boom'), refetch }}>
        {(data) => <p>{data}</p>}
      </QueryBoundary>,
    )
    await expect.element(page.getByText('boom')).toBeVisible()
    expect(page.getByText('stale').elements()).toHaveLength(0)
    await page.getByRole('button', { name: 'Try again' }).click()
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('says "not found" in the page\'s words for a 404', async () => {
    await renderPage(
      <QueryBoundary
        query={{ data: undefined, error: new HttpError(404, 'nope'), refetch: idle }}
        notFound="This team doesn't exist"
      >
        {() => null}
      </QueryBoundary>,
    )
    await expect.element(page.getByText("This team doesn't exist")).toBeVisible()
  })

  it('shows the forbidden state instead of the error when the check accepts it', async () => {
    await renderPage(
      <QueryBoundary
        query={{ data: undefined, error: new HttpError(403, 'no'), refetch: idle }}
        forbidden={<p>Admins only</p>}
        isForbidden={(error) => error instanceof HttpError && error.status === 403}
      >
        {() => null}
      </QueryBoundary>,
    )
    await expect.element(page.getByText('Admins only')).toBeVisible()
    expect(page.getByRole('button', { name: 'Try again' }).elements()).toHaveLength(0)
  })
})
