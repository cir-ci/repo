import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { BuildSettings } from '#features/settings/BuildSettings.tsx'
import { fakeFetch, pending, restoreFetch } from '#test/features/fetch-routes.ts'
import { renderPage } from '#test/support/render.tsx'

const PATH = '/api/workspaces/acme/settings'
const answer = (flakyBlocksMerge: boolean, canManage = true) => ({
  canManage,
  settings: { flakyBlocksMerge },
})
const control = () => page.getByRole('switch', { name: /^Flaky screenshots block merges/ })

afterEach(() => restoreFetch())

describe('BuildSettings', () => {
  it('renders nothing until the settings are known', async () => {
    await page.viewport(1000, 800)
    fakeFetch({ [`GET ${PATH}`]: () => pending() })
    await renderPage(<BuildSettings workspace="acme" />)
    expect(page.getByRole('heading', { name: 'Merge gate defaults' }).elements()).toHaveLength(0)
  })

  it('shows the setting as it is saved', async () => {
    await page.viewport(1000, 800)
    fakeFetch({ [`GET ${PATH}`]: answer(true) })
    await renderPage(<BuildSettings workspace="acme" />)
    await expect.element(page.getByRole('heading', { name: 'Merge gate defaults' })).toBeVisible()
    await expect.element(control()).toBeChecked()
  })

  it('saves a change with one field and shows the new state', async () => {
    await page.viewport(1000, 800)
    let flaky = true
    const calls = fakeFetch({
      [`GET ${PATH}`]: () => answer(flaky),
      [`PATCH ${PATH}`]: () => {
        flaky = false
        return { settings: { flakyBlocksMerge: false } }
      },
    })
    await renderPage(<BuildSettings workspace="acme" />)
    await control().click()
    await expect.element(control()).not.toBeChecked()
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ flakyBlocksMerge: false })
  })

  it('is read-only for members', async () => {
    await page.viewport(1000, 800)
    fakeFetch({ [`GET ${PATH}`]: answer(false, false) })
    await renderPage(<BuildSettings workspace="acme" />)
    await expect.element(control()).toHaveAttribute('data-disabled')
    await expect.element(control()).not.toBeChecked()
  })

  it('shows why a change was refused', async () => {
    await page.viewport(1000, 800)
    fakeFetch({
      [`GET ${PATH}`]: answer(true),
      [`PATCH ${PATH}`]: () =>
        Response.json(
          { error: 'Only owners and admins can change workspace settings' },
          { status: 403 },
        ),
    })
    await renderPage(<BuildSettings workspace="acme" />)
    await control().click()
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('Only owners and admins can change workspace settings')
  })
})
