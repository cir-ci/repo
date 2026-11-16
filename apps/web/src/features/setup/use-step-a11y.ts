import { useAnnounce } from '@circi/ui'
import { useCallback, useEffect, useRef, useState } from 'react'

import { stepAnnouncement } from './setup-model.ts'

/**
 * Says "Step 2 of 4: Workspace" through the page's polite live region whenever the step changes,
 * because the visible "Step N of M" is not one and a screen reader would hear nothing. `initial`
 * is for a page that appears in place of another (steps 3 and 4 replace the account page after
 * signing in): its first step is announced too; the page's first load is not (the title says it).
 */
export function useAnnounceStep(step: number, initial = false): void {
  const announce = useAnnounce()
  const announced = useRef<number | undefined>(initial ? undefined : step)
  useEffect(() => {
    if (announced.current === step) return
    announced.current = step
    announce(stepAnnouncement(step))
  }, [step, announce])
}

/**
 * Moves focus to the first field the form marks invalid, so that a refused submit lands on the
 * problem instead of staying on the button. Put `formRef` on the form and call `focusInvalid()`
 * in the same event handler that sets the errors: the focus happens after they are drawn.
 */
export function useFocusFirstInvalid() {
  const formRef = useRef<HTMLFormElement>(null)
  const [requests, setRequests] = useState(0)
  useEffect(() => {
    if (requests === 0) return
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [requests])
  const focusInvalid = useCallback(() => setRequests((n) => n + 1), [])
  return { formRef, focusInvalid }
}
