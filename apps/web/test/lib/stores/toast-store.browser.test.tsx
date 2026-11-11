import { describe, expect, it } from 'vitest'

import { HttpError } from '#lib/http.ts'
import { useToastStore } from '#lib/stores/toast-store.ts'
import { copiedToast, failureMessage, toast } from '#lib/toast.ts'
import { withUndo } from '#lib/undo.ts'

import { fakeFetch } from '../../support/fetch.ts'

const open = () => useToastStore.getState().toasts

describe('failureMessage', () => {
  it('says what failed, and why when the server gave a reason (a refusal, below 500)', () => {
    expect(failureMessage('save', new HttpError(409, 'That name is taken'))).toBe(
      "Couldn't save: That name is taken",
    )
  })

  it('gives no reason for a failure of ours or of the network', () => {
    expect(failureMessage('save', new HttpError(500, 'HTTP 500'))).toBe("Couldn't save")
    expect(failureMessage('save', new TypeError('Failed to fetch'))).toBe("Couldn't save")
  })

  it('gives the message of a plain Error the app threw with a reason', () => {
    expect(failureMessage('send the invitation', new Error('Mail is down'))).toBe(
      "Couldn't send the invitation: Mail is down",
    )
  })
})

describe('toast store', () => {
  it('opens a success toast without Undo', () => {
    toast('Saved')
    expect(open()).toMatchObject([{ message: 'Saved', tone: 'success', undoable: false }])
  })

  it('opens an error toast with the error tone', () => {
    toast.failed('save', new HttpError(400, 'Name is required'))
    expect(open()).toMatchObject([
      { message: "Couldn't save: Name is required", tone: 'error', undoable: false },
    ])
  })

  it('says whether a copy worked', () => {
    copiedToast('Link')(true)
    copiedToast('Link')(false)
    expect(open().map((t) => [t.message, t.tone])).toEqual([
      ['Link copied', 'success'],
      ["Couldn't copy the link", 'error'],
    ])
  })

  it('dismisses one toast and forgets it', () => {
    const id = toast('One')
    toast('Two')
    useToastStore.getState().dismiss(id)
    expect(open().map((t) => t.message)).toEqual(['Two'])
  })

  it('runs Undo once, closes the toast and says it was undone', async () => {
    let runs = 0
    const id = toast.undoable('Approved build #1', async () => {
      runs += 1
    })
    expect(open()[0]?.undoable).toBe(true)
    await useToastStore.getState().undo(id)
    await useToastStore.getState().undo(id)
    expect(runs).toBe(1)
    expect(open().map((t) => t.message)).toEqual(['Undone'])
  })

  it("shows the server's reason when Undo is refused", async () => {
    const id = toast.undoable('Approved', () =>
      Promise.reject(new HttpError(409, 'Someone changed this review since')),
    )
    await useToastStore.getState().undo(id)
    expect(open()).toMatchObject([{ message: 'Someone changed this review since', tone: 'error' }])
  })

  it("falls back to the action's own words when Undo fails for no reason", async () => {
    const id = toast.undoable(
      'Approved',
      () => Promise.reject(new Error('boom')),
      "Couldn't undo it",
    )
    await useToastStore.getState().undo(id)
    expect(open()).toMatchObject([{ message: "Couldn't undo it", tone: 'error' }])
  })

  it('reset closes everything', () => {
    toast('One')
    toast.error('Two')
    useToastStore.getState().reset()
    expect(open()).toEqual([])
  })
})

describe('withUndo', () => {
  it('offers no Undo when the action changed nothing (no token)', () => {
    expect(withUndo('Nothing to change', null, null, async () => {})).toEqual({
      message: 'Nothing to change',
    })
  })

  it("posts to the project's undo route, then refreshes", async () => {
    const calls = fakeFetch({ 'POST /api/projects/acme/web/undo/u1': { undone: true } })
    let refreshed = false
    const input = withUndo(
      'Approved',
      { id: 'u1', expiresAt: '2026-11-10T00:00:00Z' },
      { workspace: 'acme', project: 'web' },
      async () => {
        refreshed = true
      },
    )
    await input.undo?.()
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /api/projects/acme/web/undo/u1',
    ])
    expect(refreshed).toBe(true)
  })

  it("posts to the inbox's undo route when there is no project", async () => {
    const calls = fakeFetch({ 'POST /api/inbox/undo/u2': { undone: true } })
    const input = withUndo('Marked as read', { id: 'u2', expiresAt: '' }, null, async () => {})
    await input.undo?.()
    expect(calls.map((c) => c.path)).toEqual(['/api/inbox/undo/u2'])
  })
})
