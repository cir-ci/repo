import { Collapsible as BaseCollapsible } from '@base-ui/react/collapsible'
import { type ReactNode, useId } from 'react'

import { ChevronRightIcon } from './icons.ts'

import styles from './NavSection.module.css'

/**
 * A labelled group of `NavItem`s in a navigation (a landmark-free `section` named by its label).
 * With `open` and `onOpenChange` the label is a button that folds the group (`aria-expanded`, a
 * chevron before the name): a folded group keeps its label and drops its items from the page and
 * the tab order.
 */
export function NavSection({ label, actions, open, onOpenChange, children }: NavSection.Props) {
  const id = useId()
  if (open === undefined) {
    return (
      <section aria-labelledby={id} className={styles.root}>
        <div className={styles.head}>
          <div id={id} className={styles.label}>
            {label}
          </div>
          {actions}
        </div>
        {children}
      </section>
    )
  }
  return (
    <BaseCollapsible.Root
      open={open}
      onOpenChange={(next) => onOpenChange?.(next)}
      render={<section aria-labelledby={id} className={styles.root} />}
    >
      <div className={styles.head}>
        <BaseCollapsible.Trigger id={id} className={styles.toggle}>
          <ChevronRightIcon size={14} strokeWidth={2} aria-hidden className={styles.chevron} />
          <span className={styles.name}>{label}</span>
        </BaseCollapsible.Trigger>
        {actions}
      </div>
      <BaseCollapsible.Panel className={styles.panel}>{children}</BaseCollapsible.Panel>
    </BaseCollapsible.Root>
  )
}

export namespace NavSection {
  export interface Props {
    /** Names the section; a node so it can hold an avatar or a project mark. */
    label: ReactNode
    /** Controls beside the label (a switcher): outside the section's name. */
    actions?: ReactNode
    /** Makes the section foldable: whether its items are shown. Give `onOpenChange` with it. */
    open?: boolean
    onOpenChange?: (open: boolean) => void
    children: ReactNode
  }
}
