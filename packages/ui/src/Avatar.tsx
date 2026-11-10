import { Avatar as BaseAvatar } from '@base-ui/react/avatar'
import type { CSSProperties } from 'react'

import { cx } from './cx.ts'

import styles from './Avatar.module.css'

/** "Ada Lovelace" → "AL", "ada@example.com" → "A"; never empty. */
export function initials(name: string): string {
  const words = (name.split('@')[0] ?? '')
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean)
  const letters = words.length > 1 ? [words[0], words.at(-1)] : [words[0]]
  const text = letters
    .map((word) => word?.[0] ?? '')
    .join('')
    .toUpperCase()
  return text || '?'
}

/** Below this diameter two letters cannot fit a circle at a readable size: one is shown. */
const TWO_LETTERS_FROM = 20

/** Two wide capitals ("MM") are about 1.7em across, so the type must stay under the circle's width. */
const fontSizeFor = (size: number) =>
  size < TWO_LETTERS_FROM
    ? Math.max(9, Math.round(size * 0.55))
    : size < 28
      ? Math.round(size * 0.4)
      : Math.max(11, Math.round(size * 0.42))

/**
 * A round avatar on Base UI's `Avatar`: the image when it
 * loads, otherwise the initials of `name`. The element is an image named by `name`.
 */
export function Avatar({ name, src, size = 24, className, style, ...rest }: Avatar.Props) {
  return (
    <BaseAvatar.Root
      {...rest}
      role="img"
      aria-label={name}
      data-size={size}
      className={cx(styles.root, className)}
      style={{
        ...style,
        width: size,
        height: size,
        fontSize: fontSizeFor(size),
      }}
    >
      {src ? <BaseAvatar.Image src={src} alt="" className={styles.image} /> : null}
      <BaseAvatar.Fallback className={styles.fallback}>
        {size < TWO_LETTERS_FROM ? initials(name).slice(0, 1) : initials(name)}
      </BaseAvatar.Fallback>
    </BaseAvatar.Root>
  )
}

export namespace Avatar {
  export interface Props
    // `children` are ours (image + fallback); `className` is a plain string so it merges via `cx`; `style` likewise.
    extends Omit<BaseAvatar.Root.Props, 'children' | 'className' | 'style' | 'render'> {
    /** The person's or organization's name: the accessible name and the source of the initials. */
    name: string
    src?: string
    /** Diameter in px; 24 in rows and the sidebar. */
    size?: number
    className?: string
    style?: CSSProperties
  }
}
