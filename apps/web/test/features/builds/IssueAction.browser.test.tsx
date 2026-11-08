import type { Issue } from '@circi/api'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { IssueAction } from '#features/builds/IssueAction.tsx'
import { LinkedIssues } from '#features/builds/LinkedIssues.tsx'
import { fakeApi, restoreFetch } from '#test/features/fetch-routes.ts'
import { renderPage } from '#test/support/render.tsx'

import { detail } from './fake-build-api.tsx'

afterEach(() => restoreFetch())

const ISSUES = '/api/projects/acme/web-app/builds/7/issues'
const jira: Issue.Tracker = {
  integrationId: 'i1',
  kind: 'jira',
  name: 'acme.atlassian.net',
  target: 'WEB',
}
const linear: Issue.Tracker = { integrationId: 'i2', kind: 'linear', name: 'Acme', target: 't1' }

const show = (snapshotName: string | null = 'checkout / payment') =>
  renderPage(
    <IssueAction data={detail({ reviewStatus: 'rejected' })} snapshotName={snapshotName} />,
  )

describe('IssueAction', () => {
  it('shows nothing when the project has no tracker mapped', async () => {
    const fake = fakeApi({ [`GET ${ISSUES}`]: { body: { issues: [], trackers: [] } } })
    await show()
    await expect.poll(() => fake.of('GET')).toHaveLength(1)
    expect(page.getByRole('button', { name: 'Create issue' }).elements()).toHaveLength(0)
  })

  it('creates an issue for the selected snapshot with a preview of the description', async () => {
    await page.viewport(1000, 800)
    const fake = fakeApi({
      [`GET ${ISSUES}`]: { body: { issues: [], trackers: [jira] } },
      [`POST ${ISSUES}`]: {
        status: 201,
        body: { key: 'WEB-9', url: 'https://x.test/WEB-9', title: 'Visual regression' },
      },
    })
    await show()
    await page.getByRole('button', { name: 'Create issue' }).click()
    const dialog = page.getByRole('dialog', { name: 'Create issue' })
    await expect.element(dialog).toBeVisible()
    await expect
      .element(dialog.getByRole('textbox', { name: 'Title' }))
      .toHaveValue('Visual regression: checkout / payment in build #7')
    const preview = dialog.getByLabelText('Description preview')
    await expect.poll(() => preview.element().textContent).toContain('Branch: feature/checkout')
    // One tracker: no choice to make.
    expect(dialog.getByRole('combobox', { name: 'Tracker' }).elements()).toHaveLength(0)

    await dialog.getByRole('textbox', { name: 'Title' }).fill('Payment form is misaligned')
    await dialog.getByRole('button', { name: 'Create issue' }).click()
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
    expect(fake.of('POST')[0]?.body).toEqual({
      integrationId: 'i1',
      snapshotName: 'checkout / payment',
      title: 'Payment form is misaligned',
    })
    await expect.element(dialog).not.toBeInTheDocument()
  })

  it('sends no title when the default is kept, and lets you choose between two trackers', async () => {
    await page.viewport(1000, 800)
    const fake = fakeApi({
      [`GET ${ISSUES}`]: { body: { issues: [], trackers: [jira, linear] } },
      [`POST ${ISSUES}`]: { status: 201, body: { key: 'ENG-1', url: 'u', title: 't' } },
    })
    await show(null)
    await page.getByRole('button', { name: 'Create issue' }).click()
    const dialog = page.getByRole('dialog', { name: 'Create issue' })
    await dialog.getByRole('combobox', { name: 'Tracker' }).click()
    await page.getByRole('option', { name: 'Linear (Acme)' }).click()
    await dialog.getByRole('button', { name: 'Create issue' }).click()
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
    expect(fake.of('POST')[0]?.body).toEqual({ integrationId: 'i2' })
  })

  it('shows the tracker’s failure and keeps the dialog open', async () => {
    await page.viewport(1000, 800)
    fakeApi({
      [`GET ${ISSUES}`]: { body: { issues: [], trackers: [jira] } },
      [`POST ${ISSUES}`]: { status: 502, body: { error: 'Jira did not accept the request' } },
    })
    await show()
    await page.getByRole('button', { name: 'Create issue' }).click()
    const dialog = page.getByRole('dialog', { name: 'Create issue' })
    await dialog.getByRole('button', { name: 'Create issue' }).click()
    await expect.element(dialog.getByText('Jira did not accept the request')).toBeVisible()
    await expect.element(dialog).toBeVisible()
  })
})

describe('LinkedIssues', () => {
  it('lists the issues with links, and nothing when there are none', async () => {
    await renderPage(
      <LinkedIssues
        issues={[{ key: 'WEB-9', url: 'https://x.test/WEB-9', title: 'Header broke' }]}
      />,
    )
    const link = page.getByRole('link', { name: 'WEB-9' })
    await expect.element(link).toHaveAttribute('href', 'https://x.test/WEB-9')
    await expect.element(page.getByText('Header broke')).toBeVisible()
  })
})
