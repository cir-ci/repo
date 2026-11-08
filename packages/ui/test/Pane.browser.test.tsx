import { expect, it, describe } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { Button, Pane } from '../src/index.ts'

describe('Pane', () => {
  it('is a region named by its label, with the context in its header', async () => {
    await render(
      <Pane label="Preview" context="login.png" actions={<Button>Open</Button>}>
        Body
      </Pane>,
    )
    const pane = page.getByRole('region', { name: 'Preview' })
    await expect.element(pane).toBeInTheDocument()
    await expect.element(pane.getByRole('heading', { name: 'Preview' })).toBeInTheDocument()
    await expect.element(pane.getByText('login.png')).toBeInTheDocument()
    await expect.element(pane.getByText('Body')).toBeInTheDocument()
  })

  it('puts the actions after the body, aligned to the right', async () => {
    await render(
      <Pane label="Preview" actions={<Button>Open</Button>}>
        Body
      </Pane>,
    )
    const open = page.getByRole('button', { name: 'Open' }).element()
    const footer = open.parentElement!
    expect(getComputedStyle(footer).justifyContent).toBe('flex-end')
    const body = page.getByText('Body').element()
    expect(body.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('has width tiers', async () => {
    await render(
      <div style={{ display: 'flex', width: 1000 }}>
        <Pane label="Small" width="sm" />
        <Pane label="Large" width="lg" />
      </div>,
    )
    const small = page.getByRole('region', { name: 'Small' }).element()
    const large = page.getByRole('region', { name: 'Large' }).element()
    expect(small.getBoundingClientRect().width).toBe(280)
    expect(large.getBoundingClientRect().width).toBe(420)
  })
})
