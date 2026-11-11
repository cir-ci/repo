import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { Avatar, AvatarStack } from '#src/index.ts'

const people = ['Ada Lovelace', 'Grace Hopper', 'Alan Turing']

function People({ more }: { more?: AvatarStack.More }) {
  return (
    <div style={{ padding: 24 }}>
      <AvatarStack data-testid="stack" {...(more ? { more } : {})}>
        {people.map((name) => (
          <Avatar key={name} type="user" id={name} name={name} image={null} size={20} />
        ))}
      </AvatarStack>
    </div>
  )
}

const stack = () => page.getByTestId('stack')
const items = () => [...stack().element().children] as HTMLElement[]
const lefts = () => items().map((el) => el.getBoundingClientRect().left)
const settle = () => new Promise((resolve) => setTimeout(resolve, 600))

describe('AvatarStack', () => {
  it('overlaps its items by 4px at rest, each with a 2px ring', async () => {
    await render(<People />)
    const [a, b, c] = lefts() as [number, number, number]
    expect(b - a).toBe(16)
    expect(c - b).toBe(16)
    expect(getComputedStyle(items()[1]!).boxShadow).toContain('2px')
  })

  it('spreads apart on hover: the overlap goes and a gap opens, without moving the layout box', async () => {
    await render(<People />)
    const box = stack().element().getBoundingClientRect()
    await page.getByRole('img', { name: 'Ada Lovelace' }).hover()
    await settle()
    const rects = items().map((el) => el.getBoundingClientRect())
    // 20px items, 2px apart.
    expect(rects[1]!.left - rects[0]!.right).toBeCloseTo(2, 0)
    expect(rects[2]!.left - rects[1]!.right).toBeCloseTo(2, 0)
    // Only transforms moved: the stack's own box is where it was.
    expect(stack().element().getBoundingClientRect().width).toBe(box.width)
  })

  it('closes again when the pointer leaves', async () => {
    await render(<People />)
    const rest = lefts()
    await page.getByRole('img', { name: 'Ada Lovelace' }).hover()
    await settle()
    await page.getByRole('img', { name: 'Ada Lovelace' }).unhover()
    await settle()
    expect(lefts()).toEqual(rest)
  })

  it('spreads while focus is inside, and draws a focused link above its neighbours', async () => {
    await render(
      <AvatarStack data-testid="stack">
        {people.map((name) => (
          <a key={name} href={`#${name}`} aria-label={name}>
            <Avatar type="user" id={name} name={name} image={null} size={20} />
          </a>
        ))}
      </AvatarStack>,
    )
    const rest = lefts()
    const link = page.getByRole('link', { name: 'Grace Hopper' })
    ;(link.element() as HTMLElement).focus()
    await settle()
    expect(lefts()[2]! - rest[2]!).toBeGreaterThan(0)
    const slot = link.element().parentElement!
    expect(getComputedStyle(slot).zIndex).toBe('1')
  })

  it('ends in a "+N" chip that spreads with the rest, and draws none for 0', async () => {
    await render(<People more={{ count: 3, label: '3 more: A, B, C', tooltip: 'A, B, C' }} />)
    const chip = page.getByText('+3')
    await expect.element(chip).toBeVisible()
    await expect.element(page.getByLabelText('3 more: A, B, C')).toHaveAttribute('tabindex', '0')
    expect(items()).toHaveLength(4)
  })

  it('draws no chip for a count of 0', async () => {
    await render(<People more={{ count: 0 }} />)
    expect(items()).toHaveLength(3)
  })

  it('stays still with spread off', async () => {
    await render(
      <AvatarStack data-testid="stack" spread={false}>
        {people.map((name) => (
          <Avatar key={name} type="user" id={name} name={name} image={null} size={20} />
        ))}
      </AvatarStack>,
    )
    const rest = lefts()
    await page.getByRole('img', { name: 'Ada Lovelace' }).hover()
    await settle()
    expect(lefts()).toEqual(rest)
  })

  it('animates the spread with an overshoot curve, and without any under reduced motion', async () => {
    await render(<People />)
    const transition = getComputedStyle(items()[1]!)
    expect(transition.transitionProperty).toBe('transform')
    expect(transition.transitionTimingFunction).toBe('cubic-bezier(0.34, 1.56, 0.64, 1)')
    expect(transition.transitionDuration).toBe('0.28s')
    // The reduced-motion rule is in the stylesheet: `transition: none`.
    const rules = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules])
    const reduced = rules.filter(
      (rule): rule is CSSMediaRule =>
        rule instanceof CSSMediaRule && rule.conditionText.includes('prefers-reduced-motion'),
    )
    const texts = reduced.flatMap((rule) => [...rule.cssRules].map((r) => r.cssText))
    expect(texts.some((t) => t.includes('transition: none') && t.includes('data-spread'))).toBe(
      true,
    )
  })
})
