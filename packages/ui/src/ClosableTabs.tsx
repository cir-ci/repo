import { Tabs } from '@base-ui/react/tabs'
import {
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { ContextMenu } from './ContextMenu.tsx'
import { CloseIcon } from './icons.ts'
import type { Menu } from './Menu.tsx'

import styles from './ClosableTabs.module.css'

/** Where a tab's close button goes: the tab's right edge (the CSS pulls it back inside). */
function placeCloseButtons(rail: HTMLElement | null): void {
  if (!rail) return
  for (const close of rail.querySelectorAll<HTMLElement>('[data-close-for]')) {
    const tab = rail.querySelector<HTMLElement>(
      `[role="tab"][data-tab-id="${CSS.escape(close.dataset['closeFor'] ?? '')}"]`,
    )
    if (tab) close.style.left = `${tab.offsetLeft + tab.offsetWidth}px`
  }
}

/** The id of the tab (or the tab's close button) an event came from. */
function tabIdOf(target: EventTarget): string | null {
  if (!(target instanceof Element)) return null
  const el = target.closest<HTMLElement>('[data-tab-id], [data-close-for]')
  return el?.dataset['tabId'] ?? el?.dataset['closeFor'] ?? null
}

/**
 * A row of tabs like a browser's, on Base UI's `Tabs`: one `tablist` of `tab` buttons (the chosen
 * tab is the one Tab stop; arrow keys move between them, Home and End jump, Enter or Space
 * chooses; Delete closes the focused tab), the chosen one highlighted by a `Tabs.Indicator` that
 * glides to it. A right click (or the context menu key) opens the tab's `menu`; a middle click
 * closes it.
 *
 * A tab's close button is not inside the tablist, where a button is not allowed: the buttons are
 * a layer after it, each placed over its tab's right edge, shown while the tab is hovered,
 * focused or chosen. They are out of the Tab order (the keyboard closes with Delete). Pinned
 * tabs show their `icon` only and have no close button. Tabs are 180px wide and shrink to 96px.
 * `children` goes after the row (a new-tab button).
 */
export function ClosableTabs({
  label,
  tabs,
  value,
  onChange,
  onClose,
  children,
}: ClosableTabs.Props) {
  const rail = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)

  // After each render (tabs coming and going change every width) and when the row is resized.
  useLayoutEffect(() => {
    placeCloseButtons(rail.current)
  })
  useLayoutEffect(() => {
    const strip = rail.current
    if (!strip) return undefined
    const resized = new ResizeObserver(() => placeCloseButtons(strip))
    resized.observe(strip)
    return () => resized.disconnect()
  }, [])

  const closeFocused = (event: KeyboardEvent, id: string) => {
    if (event.key !== 'Delete') return
    event.preventDefault()
    onClose(id)
  }

  return (
    <Tabs.Root
      value={value}
      onValueChange={(next) => {
        if (typeof next === 'string') onChange(next)
      }}
      className={styles.root}
    >
      <div
        ref={rail}
        className={styles.rail}
        onPointerOver={(event: PointerEvent) => setHovered(tabIdOf(event.target))}
        onPointerLeave={() => setHovered(null)}
        onFocus={(event: FocusEvent) => setFocused(tabIdOf(event.target))}
        onBlur={() => setFocused(null)}
      >
        <Tabs.List aria-label={label} className={styles.list}>
          <Tabs.Indicator className={styles.indicator} />
          {tabs.map((tab) => {
            const middleClick = (event: MouseEvent) => {
              if (event.button !== 1) return
              event.preventDefault()
              onClose(tab.id)
            }
            const item = (
              <Tabs.Tab
                key={tab.id}
                value={tab.id}
                className={styles.tab}
                data-tab-id={tab.id}
                data-pinned={tab.pinned ? '' : undefined}
                data-hot={hovered === tab.id ? '' : undefined}
                {...(tab.pinned ? { 'aria-label': tab.label, title: tab.label } : {})}
                onAuxClick={middleClick}
                onKeyDown={(event) => closeFocused(event, tab.id)}
              >
                {tab.icon}
                {tab.pinned ? null : <span className={styles.label}>{tab.label}</span>}
              </Tabs.Tab>
            )
            return tab.menu ? <ContextMenu key={tab.id} items={tab.menu} trigger={item} /> : item
          })}
        </Tabs.List>
        <div className={styles.closes}>
          {tabs.map((tab) =>
            tab.pinned ? null : (
              <button
                key={tab.id}
                type="button"
                className={styles.close}
                data-close-for={tab.id}
                data-shown={
                  tab.id === value || tab.id === hovered || tab.id === focused ? '' : undefined
                }
                aria-label={`Close ${tab.label}`}
                tabIndex={-1}
                onClick={() => onClose(tab.id)}
              >
                <CloseIcon size={14} />
              </button>
            ),
          )}
        </div>
      </div>
      {children}
    </Tabs.Root>
  )
}

export namespace ClosableTabs {
  export interface Tab {
    /** The tab's key and value. */
    id: string
    /** The tab's name; with `pinned` it is only the accessible name. */
    label: string
    /** Before the label (16px): what stands in for the page. */
    icon: ReactNode
    /** Icon only, no close button. */
    pinned?: boolean
    /** The right-click menu; none leaves the browser's own. */
    menu?: ReadonlyArray<Menu.Entry>
  }
  export interface Props {
    /** The tablist's accessible name. */
    label: string
    tabs: ReadonlyArray<Tab>
    /** The id of the chosen tab. */
    value: string
    onChange: (id: string) => void
    onClose: (id: string) => void
    /** After the row, in the same flex line (a new-tab button). */
    children?: ReactNode
  }
}
