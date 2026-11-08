import { Button as BaseButton } from '@base-ui/react/button'
import type { MouseEventHandler, ReactNode } from 'react'

import { cx } from './cx.ts'

import styles from './Button.module.css'

/**
 * Provisional (docs/design-gaps.md §1): a button on Base UI. Variants and sizes are data
 * attributes styled in `Button.module.css`; colours come from the `--circi-*` tokens only.
 *
 * `loading` keeps the label, shows a small spinner and disables the button (it stays focusable,
 * so a keyboard user isn't thrown off it).
 *
 * With `href` it renders a real anchor with the same look, for a control that goes somewhere
 * (it isn't a button, so it has no `loading` or `disabled`). `variant="link"` drops the chrome: accent
 * text, underlined on hover, for an action that reads as a sentence.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  leading,
  className,
  disabled,
  children,
  href,
  onClick,
  ...rest
}: Button.Props) {
  if (href !== undefined) {
    return (
      <a
        href={href}
        onClick={onClick}
        className={cx(styles['root'], className)}
        data-variant={variant}
        data-size={size}
      >
        {leading}
        {children}
      </a>
    )
  }
  return (
    <BaseButton
      type="button"
      {...rest}
      onClick={onClick}
      className={cx(styles['root'], className)}
      data-variant={variant}
      data-size={size}
      data-loading={loading ? '' : undefined}
      disabled={disabled || loading}
      focusableWhenDisabled={loading || undefined}
      aria-busy={loading || undefined}
    >
      {loading ? <span className={styles['spinner']} aria-hidden="true" /> : leading}
      {children}
    </BaseButton>
  )
}

export namespace Button {
  export interface Props extends Omit<
    BaseButton.Props,
    'render' | 'children' | 'className' | 'onClick'
  > {
    /** `secondary` is the default; `primary` for the one action a screen leads to; `link` for a text-only action. */
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'link'
    /** `md` is 28px high, `sm` 24px. */
    size?: 'md' | 'sm'
    /** Show a spinner and disable the button while the action runs. */
    loading?: boolean
    /** An icon before the label (16px; replaced by the spinner while loading). */
    leading?: ReactNode
    children?: ReactNode
    /** Render an anchor instead of a button, to go somewhere (client-side routing: `preventDefault()` in `onClick`). */
    href?: string
    onClick?: MouseEventHandler<HTMLElement>
    className?: string
  }
}
