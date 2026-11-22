import { onTestFinished, vi } from 'vitest'

/**
 * Replaces `navigator.clipboard` with one whose `writeText` is the returned spy (it resolves,
 * unless given another answer) until the test is over. A refusing clipboard:
 * `stubClipboard(() => Promise.reject(new Error('denied')))`.
 */
export function stubClipboard(
  answer: (text: string) => Promise<void> = () => Promise.resolve(),
): ReturnType<typeof vi.fn<(text: string) => Promise<void>>> {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  const writeText = vi.fn<(text: string) => Promise<void>>(answer)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  onTestFinished(() => {
    if (original) Object.defineProperty(navigator, 'clipboard', original)
    else Reflect.deleteProperty(navigator, 'clipboard')
  })
  return writeText
}
