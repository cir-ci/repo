import { describe, expect, it } from 'vitest'

import { circiScreenshot, screenshotPath, settlePage, STABILIZE_CSS } from '#src/screenshot.ts'

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
        { dir: 'shots', root: '/proj', ready: () => void calls.push('ready') },
      )
      expect(path).toBe('shots/home/hero.png')
      // Absolute: Vitest resolves a relative `path` against the test file, not the project, where
      // the reporter would not look (found by the first real browser-mode run).
      expect(calls).toEqual(['ready', '/proj/shots/home/hero.png'])
    } finally {
      Reflect.deleteProperty(globalThis, 'document')
    }
  })

  it('keeps an absolute folder as it is', async () => {
    const { doc } = fakeDocument()
    Reflect.set(globalThis, 'document', doc)
    try {
      const saved: string[] = []
      await circiScreenshot({ screenshot: async (o) => void saved.push(o.path) }, 'a', {
        dir: '/tmp/out',
        root: '/proj',
      })
      expect(saved).toEqual(['/tmp/out/a.png'])
    } finally {
      Reflect.deleteProperty(globalThis, 'document')
    }
  })

  it('lets a frame pass before it waits for fonts, which are only requested after layout', async () => {
    let frames = 0
    let framesWhenFontsWereAwaited = -1
    const doc = {
      ...fakeDocument().doc,
      get fonts() {
        framesWhenFontsWereAwaited = frames
        return { ready: Promise.resolve() }
      },
    }
    Reflect.set(globalThis, 'requestAnimationFrame', (cb: () => void) => {
      frames += 1
      queueMicrotask(cb)
    })
    try {
      await settlePage(doc)
      expect(framesWhenFontsWereAwaited).toBeGreaterThanOrEqual(1)
      expect(frames).toBe(3)
    } finally {
      Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
    }
  })
})
