import { Collapsible as BaseCollapsible } from '@base-ui/react/collapsible'
import type { ReactNode } from 'react'

import { Button } from './Button.tsx'
import { cx } from './cx.ts'
import { onDisclosureArrow } from './disclosure-keys.ts'
import { ChevronRightIcon } from './icons.ts'

import styles from './Collapsible.module.css'

/**
 * Provisional: a disclosure on Base UI's `Collapsible`: a trigger button (`aria-expanded`) with a
 * chevron, a title and an optional count, over a panel that slides open. Used for the collapsed
 * "Unchanged (14)" group in the build review list. Right opens it and Left closes it from the
 * trigger, in addition to Enter and Space.
 */
export function Collapsible({ title, count, className, children, ...rest }: Collapsible.Props) {
  return (
    <BaseCollapsible.Root {...rest} className={cx(styles.root, className)}>
      <BaseCollapsible.Trigger className={styles.trigger} onKeyDown={onDisclosureArrow}>
        <ChevronRightIcon size={14} strokeWidth={2} className={styles.chevron} />
        <span className={styles.title}>{title}</span>
        {count === undefined ? null : <span className={styles.count}>{count}</span>}
      </BaseCollapsible.Trigger>
      <BaseCollapsible.Panel className={styles.panel}>{children}</BaseCollapsible.Panel>
    </BaseCollapsible.Root>
  )
}

export namespace Collapsible {
  export interface Props
    // `className` merges via `cx`, `render` would replace our structure, `title` is our heading.
    extends Omit<BaseCollapsible.Root.Props, 'className' | 'render' | 'children' | 'title'> {
    title: ReactNode
    /** A count shown after the title. */
    count?: number
    className?: string
    children?: ReactNode
  }
}

/**
 * The parts of a disclosure whose button and panel are not next to each other (a button in a row
 * of chips, its panel under the row): `CollapsibleRoot` holds the state around both, the
 * `CollapsibleTrigger` is a `Button` (with `aria-expanded`, and Right / Left as well as Enter and
 * Space) and the `CollapsiblePanel` is what it shows and hides.
 */
export function CollapsibleRoot(props: CollapsibleRoot.Props) {
  return <BaseCollapsible.Root {...props} />
}

export namespace CollapsibleRoot {
  export type Props = Omit<BaseCollapsible.Root.Props, 'render'>
}

export function CollapsibleTrigger(props: Button.Props) {
  return (
    <BaseCollapsible.Trigger
      nativeButton
      onKeyDown={onDisclosureArrow}
      render={<Button {...props} />}
    />
  )
}

export function CollapsiblePanel({ className, ...rest }: CollapsiblePanel.Props) {
  return <BaseCollapsible.Panel {...rest} className={cx(styles.panel, className)} />
}

export namespace CollapsiblePanel {
  export interface Props extends Omit<BaseCollapsible.Panel.Props, 'render' | 'className'> {
    className?: string
  }
}
