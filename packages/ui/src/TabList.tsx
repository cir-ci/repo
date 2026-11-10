import { Tabs } from '@base-ui/react/tabs'
import type { ReactNode } from 'react'

import { cx } from './cx.ts'

import styles from './TabList.module.css'

/**
 * Tabs over one panel, on Base UI's `Tabs`: a `tablist` of `tab` buttons (arrow keys move and
 * choose, wrapping; Home / End jump) and the `tabpanel` they control, named by the chosen tab. The
 * chosen tab is underlined by a `Tabs.Indicator` that slides to it. `size="sm"` is the tighter
 * row of a side panel; a tab's `label` may carry a count.
 */
export function TabList<T extends string>({
  label,
  tabs,
  value,
  onChange,
  size = 'md',
  className,
  panelClassName,
  children,
}: TabList.Props<T>) {
  return (
    <Tabs.Root
      value={value}
      onValueChange={(next) => {
        const chosen = tabs.find((t) => t.value === next)
        if (chosen) onChange(chosen.value)
      }}
      className={cx(styles.root, className)}
    >
      <Tabs.List
        aria-label={label}
        activateOnFocus
        className={styles.list}
        data-size={size === 'sm' ? 'sm' : undefined}
      >
        {tabs.map((tab) => (
          <Tabs.Tab key={tab.value} value={tab.value} className={styles.tab}>
            {tab.label}
          </Tabs.Tab>
        ))}
        <Tabs.Indicator className={styles.indicator} />
      </Tabs.List>
      <Tabs.Panel value={value} className={cx(styles.panel, panelClassName)}>
        {children}
      </Tabs.Panel>
    </Tabs.Root>
  )
}

export namespace TabList {
  export interface Tab<T extends string> {
    value: T
    label: ReactNode
  }
  export interface Props<T extends string> {
    label: string
    tabs: readonly Tab<T>[]
    value: T
    onChange: (value: T) => void
    /** `sm` is the tighter row of a side panel. */
    size?: 'md' | 'sm'
    className?: string
    /** Added to the panel the tabs control. */
    panelClassName?: string
    children: React.ReactNode
  }
}
