import { useCallback, useState } from 'react'

import { clipboard } from '#lib/clipboard.ts'
import { toast } from '#lib/toast.ts'

export { clipboard }

export type CopyState = 'idle' | 'copied' | 'failed'

/**
 * Copy text to the clipboard and remember how it went: `state` is `copied` or `failed` after a
 * `copy(text)` (back to `idle` with `reset`). Either way a toast says so ("Copied", or `what`:
 * "Link copied"), and `copy` resolves to whether the write worked.
 */
export function useCopy() {
  const [state, setState] = useState<CopyState>('idle')
  const copy = useCallback(async (text: string, what?: string) => {
    try {
      await clipboard.write(text)
    } catch {
      setState('failed')
      toast.error(what ? `Couldn't copy the ${what.toLowerCase()}` : "Couldn't copy")
      return false
    }
    setState('copied')
    toast(what ? `${what} copied` : 'Copied')
    return true
  }, [])
  const reset = useCallback(() => setState('idle'), [])
  return { copy, state, reset }
}
