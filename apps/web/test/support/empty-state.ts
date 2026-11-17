import { expect } from 'vitest'
import { page } from 'vitest/browser'

export interface ExpectedEmptyState {
  /** The sentence under the title; no sentence at all when left out. */
  body?: string | RegExp
  /** The one action's name; no button at all when left out (a member's, or a state without one). */
  action?: string
  /** `page` empty states are centred across their container. */
  centred?: boolean
  /** The tone the state carries, when it isn't neutral. */
  tone?: 'success' | 'failed'
}

/**
 * The empty-state pattern in one assertion: the title is a heading, there is a hidden 32px icon,
 * the body and the action are what the board says (or absent), and a page-size state is centred
 * across its container. Returns the state's root for further checks.
 */
export async function expectEmptyState(
  title: string | RegExp,
  expected: ExpectedEmptyState = {},
): Promise<HTMLElement> {
  const heading = page.getByRole('heading', { name: title })
  await expect.element(heading).toBeVisible()
  const root = heading.element().parentElement
  if (!root) throw new Error('The heading has no empty state around it')

  const icon = root.querySelector('[aria-hidden="true"] svg')
  expect(icon, 'the icon is hidden from assistive tech').not.toBeNull()
  expect(icon!.getBoundingClientRect().width).toBe(32)
  if (expected.tone) expect(root.dataset['tone']).toBe(expected.tone)

  const body = root.querySelector('[data-part="description"]')
  if (expected.body === undefined) {
    expect(body, 'no body').toBeNull()
  } else if (typeof expected.body === 'string') {
    expect(body?.textContent).toBe(expected.body)
  } else {
    expect(body?.textContent).toMatch(expected.body)
  }

  const buttons = [...root.querySelectorAll('button')]
  if (expected.action === undefined) {
    expect(buttons, 'no action').toHaveLength(0)
  } else {
    expect(buttons.map((b) => b.textContent)).toEqual([expected.action])
  }

  if (expected.centred) {
    const box = root.getBoundingClientRect()
    const outer = root.parentElement!.getBoundingClientRect()
    expect(Math.abs(box.left + box.width / 2 - (outer.left + outer.width / 2))).toBeLessThan(2)
  }
  return root
}
