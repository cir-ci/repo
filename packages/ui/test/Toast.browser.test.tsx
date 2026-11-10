/// <reference types="@vitest/browser-playwright" />
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { cdp, page, userEvent } from 'vitest/browser'

import {
  CirciTheme,
  createToastManager,
  TOAST_ERROR_MS,
  TOAST_MS,
  ToastProvider,
  ToastViewport,
} from '#src/index.ts'

async function setup() {
  const manager = createToastManager()
  await render(
    <CirciTheme>
      <ToastProvider manager={manager}>
        <button>Elsewhere</button>
        <ToastViewport />
      </ToastProvider>
    </CirciTheme>,
  )
  return manager
}

const toastNamed = (name: string) => page.getByRole('dialog', { name })

afterEach(async () => {
  await cdp().send('Emulation.setEmulatedMedia', { features: [] })
})

describe('Toast', () => {
  it('stays five seconds and errors ten, unless told otherwise', () => {
    expect(TOAST_MS).toBe(5000)
    expect(TOAST_ERROR_MS).toBe(10_000)
  })

  it('shows a message in a polite live region named Notifications', async () => {
    const manager = await setup()
    const region = page.getByRole('region', { name: 'Notifications' })
    await expect.element(region).toHaveAttribute('aria-live', 'polite')
    manager.add({ title: 'Approved 3 screenshots', data: { tone: 'success' } })
    await expect.element(region.getByText('Approved 3 screenshots')).toBeVisible()
    await expect
      .element(toastNamed('Approved 3 screenshots'))
      .toHaveAttribute('data-tone', 'success')
  })

  it('marks an error by tone, and an error is not announced more urgently than the rest', async () => {
    const manager = await setup()
    manager.add({ title: "Couldn't save: name is taken", data: { tone: 'error' } })
    const toast = toastNamed("Couldn't save: name is taken")
    await expect.element(toast).toHaveAttribute('data-tone', 'error')
    await expect
      .element(page.getByRole('region', { name: 'Notifications' }))
      .toHaveAttribute('aria-live', 'polite')
  })

  it('closes by itself after its timeout', async () => {
    const manager = await setup()
    manager.add({ title: 'Saved', timeout: 300, data: { tone: 'success' } })
    await expect.element(toastNamed('Saved')).toBeVisible()
    await vi.waitFor(() => expect(page.getByText('Saved').query()).toBeNull(), { timeout: 3000 })
  })

  it('pauses while hovered and runs on once the pointer leaves', async () => {
    const manager = await setup()
    manager.add({ title: 'Saved', timeout: 600, data: { tone: 'success' } })
    const toast = toastNamed('Saved')
    await expect.element(toast).toBeVisible()
    await userEvent.hover(toast)
    await new Promise((resolve) => setTimeout(resolve, 1200))
    await expect.element(toast).toBeVisible()
    await userEvent.hover(page.getByRole('button', { name: 'Elsewhere' }))
    await vi.waitFor(() => expect(page.getByText('Saved').query()).toBeNull(), { timeout: 4000 })
  })

  it('pauses while focused', async () => {
    const manager = await setup()
    manager.add({ title: 'Saved', timeout: 600, data: { tone: 'success' } })
    await expect.element(toastNamed('Saved')).toBeVisible()
    await userEvent.tab()
    await userEvent.tab()
    await new Promise((resolve) => setTimeout(resolve, 1200))
    await expect.element(toastNamed('Saved')).toBeVisible()
  })

  it('closes with its Dismiss button', async () => {
    const manager = await setup()
    manager.add({ title: 'Saved', timeout: 0, data: { tone: 'success' } })
    await expect.element(toastNamed('Saved')).toBeVisible()
    await page.getByRole('button', { name: 'Dismiss' }).click()
    await vi.waitFor(() => expect(page.getByText('Saved').query()).toBeNull())
  })

  it('shows an action button (Undo) that runs its handler', async () => {
    const manager = await setup()
    const onClick = vi.fn<() => void>()
    manager.add({
      title: 'Approved build #148',
      timeout: 0,
      actionProps: { children: 'Undo', onClick },
      data: { tone: 'success' },
    })
    await toastNamed('Approved build #148').getByRole('button', { name: 'Undo' }).click()
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('has no action button when there is nothing to undo', async () => {
    const manager = await setup()
    manager.add({ title: 'Saved', timeout: 0, data: { tone: 'success' } })
    await expect.element(toastNamed('Saved')).toBeVisible()
    expect(toastNamed('Saved').getByRole('button', { name: 'Undo' }).query()).toBeNull()
  })

  it('stacks three at most; the oldest of more is hidden, not announced again', async () => {
    const manager = await setup()
    for (const title of ['One', 'Two', 'Three', 'Four']) {
      manager.add({ title, timeout: 0, data: { tone: 'success' } })
    }
    await expect.element(toastNamed('Four')).toBeVisible()
    await expect.element(toastNamed('Two')).toBeVisible()
    await expect.element(page.getByText('One', { exact: true })).not.toBeVisible()
  })

  it('does not move when the user prefers reduced motion', async () => {
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    })
    const manager = await setup()
    manager.add({ title: 'Saved', timeout: 0, data: { tone: 'success' } })
    const element = await vi.waitFor(() => {
      const found = document.querySelector('[data-tone]')
      if (!found) throw new Error('no toast yet')
      return found
    })
    expect(getComputedStyle(element).transitionDuration).toBe('0s')
  })

  it('moves in with a transition otherwise', async () => {
    const manager = await setup()
    manager.add({ title: 'Saved', timeout: 0, data: { tone: 'success' } })
    const element = await vi.waitFor(() => {
      const found = document.querySelector('[data-tone]')
      if (!found) throw new Error('no toast yet')
      return found
    })
    expect(getComputedStyle(element).transitionDuration).not.toBe('0s')
  })
})
