import { useQuery } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { getJson } from '#lib/http.ts'
import { startLive, type LiveSource } from '#lib/live.ts'
import { keys } from '#lib/query-keys.ts'
import { renderPage } from '#test/support/render.tsx'

/** An `EventSource` the test sends events through. */
function fakeSource() {
  const listeners: Record<string, ((event: { data: unknown }) => void)[]> = {}
  const source: LiveSource = {
    readyState: 1,
    addEventListener: (type: string, listener: (event: { data: unknown }) => void) => {
      ;(listeners[type] ??= []).push(listener)
    },
    close: () => {},
  }
  return {
    source,
    open: () => listeners.open?.forEach((l) => l({ data: undefined })),
    send: (event: object) => listeners.message?.forEach((l) => l({ data: JSON.stringify(event) })),
  }
}

function Build(props: { number: number }) {
  const { data } = useQuery({
    queryKey: keys.build('acme', 'web', props.number),
    queryFn: () => getJson<{ status: string }>(`/api/probe/${props.number}`),
    // Fresh for good: only an invalidation may refetch it.
    staleTime: Infinity,
  })
  return <p>{`build ${props.number}: ${data?.status ?? 'loading'}`}</p>
}

describe('live updates', () => {
  it("a page updates in place when an event names its build, and a neighbor's page does not refetch", async () => {
    const statuses = { 7: ['uploading', 'complete'], 8: ['uploading', 'complete'] }
    const asked = { 7: 0, 8: 0 }
    const answer = (n: 7 | 8) => () => ({ body: { status: statuses[n][Math.min(asked[n]++, 1)] } })
    const { queryClient } = await renderPage(
      <>
        <Build number={7} />
        <Build number={8} />
      </>,
      { api: { 'GET /api/probe/7': answer(7), 'GET /api/probe/8': answer(8) } },
    )
    await expect.element(page.getByText('build 7: uploading')).toBeVisible()
    await expect.element(page.getByText('build 8: uploading')).toBeVisible()

    const live = fakeSource()
    const stop = startLive(queryClient, {
      createSource: () => live.source,
      visibility: { hidden: () => false, onChange: () => () => {} },
    })
    try {
      live.open()
      live.send({ type: 'build.updated', workspace: 'acme', project: 'web', build: 7 })
      await expect.element(page.getByText('build 7: complete')).toBeVisible()
      expect(asked).toEqual({ 7: 2, 8: 1 })
      await expect.element(page.getByText('build 8: uploading')).toBeVisible()
    } finally {
      stop()
    }
  })

  it("an event of another workspace's build changes nothing on the page", async () => {
    let asked = 0
    const { queryClient } = await renderPage(<Build number={7} />, {
      api: { 'GET /api/probe/7': () => ({ body: { status: `answer ${++asked}` } }) },
    })
    await expect.element(page.getByText('build 7: answer 1')).toBeVisible()
    const live = fakeSource()
    const stop = startLive(queryClient, {
      createSource: () => live.source,
      visibility: { hidden: () => false, onChange: () => () => {} },
    })
    try {
      live.open()
      live.send({ type: 'build.updated', workspace: 'rival', project: 'web', build: 7 })
      // A later event for this build proves the earlier one has been handled (they are batched in order).
      live.send({ type: 'comment.changed', workspace: 'acme', project: 'web', build: 7 })
      await expect.element(page.getByText('build 7: answer 2')).toBeVisible()
      expect(asked).toBe(2)
    } finally {
      stop()
    }
  })
})
