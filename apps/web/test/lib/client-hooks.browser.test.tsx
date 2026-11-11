import { AnnouncerProvider } from '@circi/ui'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { useLoadingAnnouncement } from '#features/builds/list/loading.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { useClientLink } from '#lib/use-client-link.ts'
import { renderPage } from '#test/support/render.tsx'

function Title(props: { parts: (string | undefined)[] }) {
  useDocumentTitle(...props.parts)
  return <p>page</p>
}

describe('useDocumentTitle', () => {
  it('lists the parts most specific first and ends with the product name', async () => {
    await renderPage(<Title parts={['Build #2', 'web-app']} />)
    await expect.poll(() => document.title).toBe('Build #2 · web-app · CirCI')
  })

  it('skips parts that are missing', async () => {
    await renderPage(<Title parts={[undefined, 'Reviews']} />)
    await expect.poll(() => document.title).toBe('Reviews · CirCI')
  })

  it('is just the product name with no parts', async () => {
    await renderPage(<Title parts={[]} />)
    await expect.poll(() => document.title).toBe('CirCI')
  })
})

function Link() {
  const link = useClientLink()
  const props = link({ to: '/inbox' })
  return (
    <a {...props} data-testid="link">
      go
    </a>
  )
}

describe('useClientLink', () => {
  it('gives a real address, and navigates without a reload on a plain click', async () => {
    const { router } = await renderPage(<Link />)
    await expect.element(page.getByRole('link', { name: 'go' })).toHaveAttribute('href', '/inbox')
    await page.getByRole('link', { name: 'go' }).click()
    await expect.poll(() => router.state.location.pathname).toBe('/inbox')
  })

  it('leaves a modified click to the browser (new tab)', async () => {
    const { router } = await renderPage(<Link />)
    await page.getByRole('link', { name: 'go' }).click({ modifiers: ['ControlOrMeta'] })
    await expect.poll(() => router.state.location.pathname).toBe('/')
  })
})

function Loading(props: { pending: boolean }) {
  useLoadingAnnouncement(props.pending, 'Loading builds', 300)
  return <p>page</p>
}

describe('useLoadingAnnouncement', () => {
  it('announces a page that is still loading after the delay, not before', async () => {
    vi.useFakeTimers()
    await renderPage(<Loading pending />, { announcer: true })
    const status = page.getByRole('status')
    await vi.advanceTimersByTimeAsync(299)
    await expect.element(status).toHaveTextContent('')
    await vi.advanceTimersByTimeAsync(400)
    await expect.element(status).toHaveTextContent('Loading builds')
  })

  it('says nothing for a page that was quick to load', async () => {
    vi.useFakeTimers()
    const { screen } = await renderPage(<Loading pending />, { announcer: true })
    await vi.advanceTimersByTimeAsync(100)
    await screen.rerender(
      <AnnouncerProvider>
        <Loading pending={false} />
      </AnnouncerProvider>,
    )
    await vi.advanceTimersByTimeAsync(1000)
    await expect.element(page.getByRole('status')).toHaveTextContent('')
  })
})
