import { createContext } from 'react'

/**
 * Where a `PanelHeader` renders: the fixed area above the panel's scroller. `undefined` outside
 * an `AppFrame` (the header renders where it is), `null` until the frame's area is mounted.
 */
export const PanelSlotContext = createContext<HTMLElement | null | undefined>(undefined)
