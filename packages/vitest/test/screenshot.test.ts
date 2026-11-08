import { describe, expect, it } from 'vitest'

import { circiScreenshot, screenshotPath, settlePage, STABILIZE_CSS } from '../src/screenshot.ts'

describe('screenshotPath', () => {
  it('makes tidy, stable names that stay inside the folder', () => {
    expect(screenshotPath('Settings / Profile Page')).toBe('settings/profile-page.png')
    expect(screenshotPath('../../etc/passwd')).toBe('etc/passwd.png')
    expect(screenshotPath('Button: primary (hover)')).toBe('button-primary-hover.png')
    expect(() => screenshotPath('///')).toThrow(/usable/)
  })
})

function fakeDocument() {
  const added: { id: string; textContent: string | null }[] = []
  return {
    added,
    doc: {
      getElementById: (id: string) => added.find((a) => a.id === id) ?? null,
      createElement: () => ({ id: '', textContent: null as string | null }),
      head: {
        append: (node: { id: string; textContent: string | null }) => void added.push(node),
      },
      fonts: { ready: Promise.resolve() },
    },
  }
}

describe('settlePage and circiScreenshot', () => {
  it('turns animation off once, however often it runs', async () => {
    const { doc, added } = fakeDocument()
    await settlePage(doc)
    await settlePage(doc)
    expect(added).toHaveLength(1)
    expect(added[0]?.textContent).toBe(STABILIZE_CSS)
    expect(STABILIZE_CSS).toContain('animation: none')
  })

  it('saves the screenshot under the folder by name, after waiting for the page', async () => {
    const { doc } = fakeDocument()
    Reflect.set(globalThis, 'document', doc)
    try {
      const calls: string[] = []
      const path = await circiScreenshot(
        { screenshot: async (opts) => void calls.push(opts.path) },
        'Home / hero',
        { dir: 'shots', ready: () => void calls.push('ready') },
      )
      expect(path).toBe('shots/home/hero.png')
      expect(calls).toEqual(['ready', 'shots/home/hero.png'])
    } finally {
      Reflect.deleteProperty(globalThis, 'document')
    }
  })
})
