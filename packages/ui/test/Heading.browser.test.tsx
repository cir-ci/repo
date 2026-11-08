import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { Heading } from '#src/index.ts'

describe('Heading', () => {
  it('maps each level to a heading element and size', async () => {
    await render(
      <>
        <Heading level="display">Welcome</Heading>
        <Heading level="title">Title</Heading>
        <Heading>Section</Heading>
      </>,
    )
    const display = page.getByRole('heading', { level: 1, name: 'Welcome' }).element()
    expect(getComputedStyle(display).fontSize).toBe('20px')
    const title = page.getByRole('heading', { level: 2, name: 'Title' }).element()
    expect(getComputedStyle(title).fontSize).toBe('15px')
    const section = page.getByRole('heading', { level: 3, name: 'Section' }).element()
    const style = getComputedStyle(section)
    expect(style.fontSize).toBe('13px')
    expect(style.fontWeight).toBe('600')
  })

  it('lets `as` change the element but not the look', async () => {
    await render(
      <Heading level="title" as="h4">
        Deep
      </Heading>,
    )
    const el = page.getByRole('heading', { level: 4, name: 'Deep' }).element()
    expect(getComputedStyle(el).fontSize).toBe('15px')
  })
})
