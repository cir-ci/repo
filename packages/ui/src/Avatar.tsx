import { Avatar as BaseAvatar } from '@base-ui/react/avatar'

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

/**
 * A round avatar on Base UI's `Avatar`: the image when it
 * loads, otherwise the initials of `name`. The element is an image named by `name`.
 */
export function Avatar({ name, src, size = 24, className }: Avatar.Props) {
  return (
    <BaseAvatar.Root
      role="img"
      aria-label={name}
      data-size={size}
      className={cx(styles['root'], className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {src ? <BaseAvatar.Image src={src} alt="" className={styles['image']} /> : null}
      <BaseAvatar.Fallback className={styles['fallback']}>{initials(name)}</BaseAvatar.Fallback>
    </BaseAvatar.Root>
  )
}

export namespace Avatar {
  export interface Props {
    /** The person's or organization's name: the accessible name and the source of the initials. */
    name: string
    src?: string
    /** Diameter in px; 24 in rows and the sidebar. */
    size?: number
    className?: string
  }
}
