import { Avatar as BaseAvatar } from '@base-ui/react/avatar'
import BoringAvatar from 'boring-avatars'
import type { CSSProperties } from 'react'

import { peoplePalette, useAvatarScheme } from './avatar-palettes.ts'
import { cx } from './cx.ts'

import styles from './Avatar.module.css'

/**
 * A round avatar on Base UI's `Avatar`: the image when it loads, otherwise a generated "beam"
 * face (`boring-avatars`) that is the same for the same `seed`. The element is an image named by
 * `name`.
 */
export function Avatar({ name, seed, src, size = 24, className, style, ...rest }: Avatar.Props) {
  const { scheme, ref } = useAvatarScheme()
  return (
    <BaseAvatar.Root
      {...rest}
      role="img"
      aria-label={name}
      data-size={size}
      className={cx(styles.root, className)}
      style={{ ...style, width: size, height: size }}
    >
      {src ? <BaseAvatar.Image src={src} alt="" className={styles.image} /> : null}
      <BaseAvatar.Fallback ref={ref} className={styles.fallback}>
        <BoringAvatar
          variant="beam"
          name={seed ?? name}
          colors={peoplePalette(scheme)}
          square
          size="100%"
          aria-hidden="true"
          role="presentation"
          data-avatar="beam"
        />
      </BaseAvatar.Fallback>
    </BaseAvatar.Root>
  )
}

export namespace Avatar {
  export interface Props
    // `children` are ours (image + fallback); `className` is a plain string so it merges via `cx`; `style` likewise.
    extends Omit<BaseAvatar.Root.Props, 'children' | 'className' | 'style' | 'render'> {
    /** The person's or organization's name: the accessible name, and the seed unless `seed` is given. */
    name: string
    /** What the generated face is drawn from: the user id, so renaming never changes it. Defaults to `name`. */
    seed?: string
    src?: string
    /** Diameter in px; 24 in rows and the sidebar. */
    size?: number
    className?: string
    style?: CSSProperties
  }
}
