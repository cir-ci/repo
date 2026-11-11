import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { SessionCheck } from '#features/auth/SessionCheck.tsx'

// The loading screen index.html draws before any script (relative: src has no # alias).
// oxlint-disable-next-line import/no-unassigned-import
import '../../../src/boot.css'

const centre = (el: Element) => {
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
}

describe('SessionCheck', () => {
  it('centres the logo where the loading screen does, so the hand-over does not move it', async () => {
    await page.viewport(1200, 800)
    // index.html's loading screen.
    const boot = document.createElement('div')
    boot.className = 'circi-boot'
    boot.innerHTML = '<img alt="CirCI" width="56" height="56">'
    document.body.append(boot)
    const before = centre(boot.querySelector('img')!)
    boot.remove()

    await render(<SessionCheck />)
    const logo = page.getByRole('img', { name: 'CirCI' })
    await expect.element(logo).toBeVisible()
    const after = centre(logo.element())
    expect(before).toEqual({ x: 600, y: 400 })
    expect(after).toEqual(before)
  })

  it('shows its note below the logo, without moving it', async () => {
    await page.viewport(1200, 800)
    await render(<SessionCheck />)
    const logo = page.getByRole('img', { name: 'CirCI' })
    await expect.element(page.getByText('Checking your session…')).toBeInTheDocument()
    const note = page.getByText('Checking your session…').element().getBoundingClientRect()
    const mark = logo.element().getBoundingClientRect()
    expect(note.top).toBeGreaterThanOrEqual(mark.bottom)
    expect(centre(logo.element()).y).toBe(400)
  })
})
