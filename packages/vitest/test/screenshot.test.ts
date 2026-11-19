import { describe, expect, it } from 'vitest'

import { settlePage, STABILIZE_CSS } from '#src/screenshot.ts'

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

describe('settlePage', () => {
  it('turns animation off once, however often it runs', async () => {
    const { doc, added } = fakeDocument()
    await settlePage(doc)
    await settlePage(doc)
    expect(added).toHaveLength(1)
    expect(added[0]?.textContent).toBe(STABILIZE_CSS)
    expect(STABILIZE_CSS).toContain('animation: none')
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
