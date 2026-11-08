import { type KeyboardEvent, useId } from 'react'

import styles from './TabList.module.css'

/**
 * Tabs over one list: a `tablist` of `tab` buttons (arrow keys move and choose, Home / End jump)
 * and the `tabpanel` they control, named by the chosen tab.
 */
export function TabList<T extends string>({
  label,
  tabs,
  value,
  onChange,
  children,
}: TabList.Props<T>) {
  const base = useId()
  const tabId = (tab: T) => `${base}-tab-${tab}`
  const panelId = `${base}-panel`

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((t) => t.value === value)
    const last = tabs.length - 1
    const to =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : undefined
    const next = to === undefined ? undefined : tabs[to]
    if (!next) return
    event.preventDefault()
    onChange(next.value)
    document.getElementById(tabId(next.value))?.focus()
  }

  return (
    <>
      {/* The arrow keys are the tabs' own keyboard model; the buttons inside are the focus targets. */}
      {/* oxlint-disable-next-line jsx-a11y/interactive-supports-focus, jsx-a11y/no-static-element-interactions */}
      <div role="tablist" aria-label={label} className={styles.list} onKeyDown={onKeyDown}>
        {tabs.map((tab) => (
          <button
            key={tab.value}
            id={tabId(tab.value)}
            type="button"
            role="tab"
            aria-selected={tab.value === value}
            aria-controls={panelId}
            tabIndex={tab.value === value ? 0 : -1}
            className={styles.tab}
            onClick={() => onChange(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={tabId(value)} className={styles.panel}>
        {children}
      </div>
    </>
  )
}

export namespace TabList {
  export interface Tab<T extends string> {
    value: T
    label: string
  }
  export interface Props<T extends string> {
    label: string
    tabs: readonly Tab<T>[]
    value: T
    onChange: (value: T) => void
    children: React.ReactNode
  }
}
