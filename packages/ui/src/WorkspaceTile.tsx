import BoringAvatar from 'boring-avatars'

import { useAvatarScheme, workspacePalette } from './avatar-palettes.ts'

import styles from './WorkspaceTile.module.css'

/**
 * A workspace's mark: a rounded square holding a generated "bauhaus" pattern (`boring-avatars`)
 * in the brand's tones, drawn from `seed` (its slug). With a picture, the picture fills the square
 * instead. Decorative: the name is written beside it.
 */
export function WorkspaceTile({ seed, picture, size = 20 }: WorkspaceTile.Props) {
  const { scheme, ref } = useAvatarScheme()
  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-size={size}
      data-picture={picture ? '' : undefined}
      className={styles.root}
    >
      {picture ? (
        <img src={picture} alt="" className={styles.picture} />
      ) : (
        <BoringAvatar
          variant="bauhaus"
          name={seed}
          colors={workspacePalette(scheme)}
          square
          size="100%"
          aria-hidden="true"
          role="presentation"
          data-avatar="bauhaus"
          className={styles.picture}
        />
      )}
    </span>
  )
}

export namespace WorkspaceTile {
  export interface Props {
    /** What the pattern is drawn from: the workspace's slug (or id). */
    seed: string
    /** The workspace's picture, when it has one: it replaces the generated pattern. */
    picture?: string | null | undefined
    size?: 16 | 20 | 24
  }
}
