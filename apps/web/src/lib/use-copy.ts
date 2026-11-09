import { useCallback, useState } from 'react'

/** Where the browser copies text to; a seam so tests can watch it. */
export const clipboard = {
  write: (text: string) => navigator.clipboard.writeText(text),
}

export type CopyState = 'idle' | 'copied' | 'failed'

/**
 * Copy text to the clipboard and remember how it went: `state` is `copied` or `failed` after a
 * `copy(text)` (back to `idle` with `reset`). `copy` resolves to whether the write worked, for
 * callers that announce the result instead of showing it.
 */
export function useCopy() {
  const [state, setState] = useState<CopyState>('idle')
  const copy = useCallback(async (text: string) => {
    try {
      await clipboard.write(text)
    } catch {
      setState('failed')
      return false
    }
    setState('copied')
    return true
  }, [])
  const reset = useCallback(() => setState('idle'), [])
  return { copy, state, reset }
}
