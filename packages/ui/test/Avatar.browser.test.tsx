import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { Avatar, initials } from '../src/index.ts'

describe('initials', () => {
  it('takes the first and last word', () => {
    expect(initials('Ada Lovelace')).toBe('AL')
    expect(initials('Ada Augusta King')).toBe('AK')
    expect(initials('ada')).toBe('A')
    expect(initials('ada@example.com')).toBe('A')
    expect(initials('  ')).toBe('?')
  })
})

describe('Avatar', () => {
  it('is an image named by the name, round, 24px by default, showing initials', async () => {
    await render(<Avatar name="Ada Lovelace" />)
    const avatar = page.getByRole('img', { name: 'Ada Lovelace' })
    await expect.element(avatar).toHaveTextContent('AL')
    const style = getComputedStyle(avatar.element())
    expect([style.width, style.height]).toEqual(['24px', '24px'])
    expect(style.borderRadius).toBe('50%')
  })

  it('takes a size', async () => {
    await render(<Avatar name="Ada" size={32} />)
    expect(getComputedStyle(page.getByRole('img').element()).width).toBe('32px')
  })

  it('keeps the initials when the image fails to load', async () => {
    await render(<Avatar name="Ada Lovelace" src="data:image/png;base64,broken" />)
    await expect.element(page.getByRole('img', { name: 'Ada Lovelace' })).toHaveTextContent('AL')
  })
})
