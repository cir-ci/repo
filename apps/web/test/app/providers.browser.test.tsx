import { QueryObserver } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '#app/providers.tsx'
import { HttpError } from '#lib/http.ts'

describe('the query client', () => {
  it('treats a 404 for something already on screen as the answer: the old data goes', async () => {
    const client = createQueryClient()
    client.setQueryData(['project', 'acme', 'web'], { name: 'Secret' })
    const observer = new QueryObserver(client, {
      queryKey: ['project', 'acme', 'web'],
      queryFn: () => Promise.reject(new HttpError(404, 'Not found')),
      staleTime: 0,
    })
    const stop = observer.subscribe(() => {})
    await vi.waitFor(() => expect(observer.getCurrentResult().error).toBeInstanceOf(HttpError))
    expect(observer.getCurrentResult().data).toBeUndefined()
    expect(client.getQueryData(['project', 'acme', 'web'])).toBeUndefined()
    stop()
  })

  it('keeps the data when the request merely fails (a 500 or no network)', async () => {
    const client = createQueryClient()
    client.setQueryData(['project', 'acme', 'web'], { name: 'Kept' })
    const observer = new QueryObserver(client, {
      queryKey: ['project', 'acme', 'web'],
      queryFn: () => Promise.reject(new HttpError(400, 'Bad request')),
      staleTime: 0,
    })
    const stop = observer.subscribe(() => {})
    await vi.waitFor(() => expect(observer.getCurrentResult().error).toBeInstanceOf(HttpError))
    expect(observer.getCurrentResult().data).toEqual({ name: 'Kept' })
    stop()
  })
})
