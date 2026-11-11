import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { DeliveriesTable } from '#features/project-settings/DeliveriesTable.tsx'

const at = (offsetMs: number) => new Date(Date.now() - offsetMs).toISOString()
const delivery = (
  deliveryId: string,
  event: string,
  statusCode: number | null,
  attempt: number,
  ago: number,
) => ({
  deliveryId,
  event,
  test: false,
  attempt,
  statusCode,
  error: statusCode === null ? 'Timed out' : null,
  createdAt: at(ago),
})

describe('DeliveriesTable', () => {
  it('sorts by a column: statuses by number with no answer last, events by name, times by date', async () => {
    await render(
      <DeliveriesTable
        url="https://a.test/hook"
        deliveries={[
          delivery('d3', 'build.reviewed', 502, 3, 60_000),
          delivery('d2', 'build.completed', null, 1, 600_000),
          delivery('d1', 'build.approved', 200, 2, 3_600_000),
        ]}
      />,
    )
    const table = page.getByRole('table', { name: 'Deliveries to https://a.test/hook' })
    const events = () =>
      [...table.element().querySelectorAll('[role="cell"]')]
        .filter((_, i) => i % 4 === 1)
        .map((c) => c.textContent)
    await expect.element(table.getByText('Timed out')).toBeVisible()
    expect(events()).toEqual(['build.reviewed', 'build.completed', 'build.approved'])

    const status = table.getByRole('columnheader', { name: 'Status' })
    await status.getByRole('button').click()
    await expect.element(status).toHaveAttribute('aria-sort', 'ascending')
    expect(events()).toEqual(['build.approved', 'build.reviewed', 'build.completed'])
    await status.getByRole('button').click()
    expect(events()).toEqual(['build.reviewed', 'build.approved', 'build.completed'])
    await status.getByRole('button').click()
    await expect.element(status).toHaveAttribute('aria-sort', 'none')
    expect(events()).toEqual(['build.reviewed', 'build.completed', 'build.approved'])

    const event = table.getByRole('columnheader', { name: 'Event' })
    await event.getByRole('button').click()
    expect(events()).toEqual(['build.approved', 'build.completed', 'build.reviewed'])

    // Another column replaces the sort: the oldest delivery first.
    const time = table.getByRole('columnheader', { name: 'Time' })
    await time.getByRole('button').click()
    await expect.element(event).toHaveAttribute('aria-sort', 'none')
    expect(events()).toEqual(['build.approved', 'build.completed', 'build.reviewed'])
    await time.getByRole('button').click()
    expect(events()).toEqual(['build.reviewed', 'build.completed', 'build.approved'])
  })
})
