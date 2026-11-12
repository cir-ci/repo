import { Avatar as BaseAvatar } from '@base-ui/react/avatar'
import BoringAvatar from 'boring-avatars'
import { lazy, Suspense, type CSSProperties, type ReactNode } from 'react'

import {
  instancePalette,
  peoplePalette,
  projectPalette,
  useAvatarScheme,
  workspacePalette,
} from './avatar-palettes.ts'
import { cx } from './cx.ts'
import type { ProjectColor } from './project-icons.ts'

import styles from './Avatar.module.css'

/** Icon size per project avatar size. */
const PROJECT_ICON_SIZE = { 16: 12, 18: 13, 20: 14, 24: 16, 40: 24 } as const

// Loaded on demand, so the app's first script carries none of Lucide's icon map (see ProjectGlyph).
const ProjectGlyph = lazy(() => import('./ProjectGlyph.tsx'))

/**
 * The identity mark of a user, a project or a workspace, on Base UI's `Avatar`. `type` says which, and
 * each type takes exactly what it is drawn from. Every drawing comes from the ID or slug, so
 * renaming never changes it; an uploaded picture (a user's `image`, a workspace's `picture`) wins
 * while it loads. The element is an image named by `name`.
 *
 * - `user`: a round "beam" face.
 * - `project`: a rounded square holding a "marble" in shades of the project's `color`, with its icon on top.
 * - `workspace`: a rounded square holding a "bauhaus" pattern in the brand's tones.
 * - `instance`: a round "ring" in cool slate and graphite, drawn from the instance's address.
 */
export function Avatar(props: Avatar.Props) {
  if (props.type === 'user') return <UserAvatar {...props} />
  if (props.type === 'project') return <ProjectAvatar {...props} />
  if (props.type === 'instance') return <InstanceAvatar {...props} />
  return <WorkspaceAvatar {...props} />
}

function UserAvatar({ type, id, name, image, size = 24, ...rest }: Avatar.UserProps) {
  const { scheme, ref } = useAvatarScheme()
  return (
    <Frame type={type} name={name} size={size} picture={image} fallbackRef={ref} {...rest}>
      <BoringAvatar
        variant="beam"
        name={id}
        colors={peoplePalette(scheme)}
        square
        size="100%"
        aria-hidden="true"
        role="presentation"
        data-avatar="beam"
      />
    </Frame>
  )
}

function ProjectAvatar({ type, slug, name, color, icon, size = 16, ...rest }: Avatar.ProjectProps) {
  const { scheme, ref } = useAvatarScheme()
  return (
    <Frame type={type} name={name} size={size} picture={null} fallbackRef={ref} {...rest}>
      <BoringAvatar
        variant="marble"
        name={slug}
        colors={projectPalette(color, scheme)}
        square
        size="100%"
        aria-hidden="true"
        role="presentation"
        data-avatar="marble"
        className={styles.marble}
      />
      {icon ? (
        // The box is reserved while the icon loads, so nothing shifts when it arrives.
        <span
          className={styles.icon}
          data-avatar-icon=""
          style={{ width: PROJECT_ICON_SIZE[size], height: PROJECT_ICON_SIZE[size] }}
        >
          <Suspense fallback={null}>
            <ProjectGlyph name={icon} size={PROJECT_ICON_SIZE[size]} />
          </Suspense>
        </span>
      ) : null}
    </Frame>
  )
}

function WorkspaceAvatar({ type, slug, name, picture, size = 20, ...rest }: Avatar.WorkspaceProps) {
  const { scheme, ref } = useAvatarScheme()
  return (
    <Frame type={type} name={name} size={size} picture={picture} fallbackRef={ref} {...rest}>
      <BoringAvatar
        variant="bauhaus"
        name={slug}
        colors={workspacePalette(scheme)}
        square
        size="100%"
        aria-hidden="true"
        role="presentation"
        data-avatar="bauhaus"
      />
    </Frame>
  )
}

function InstanceAvatar({ type, seed, name, size = 20, ...rest }: Avatar.InstanceProps) {
  const { scheme, ref } = useAvatarScheme()
  return (
    <Frame type={type} name={name} size={size} picture={null} fallbackRef={ref} {...rest}>
      <BoringAvatar
        variant="ring"
        name={seed}
        colors={instancePalette(scheme)}
        size="100%"
        aria-hidden="true"
        role="presentation"
        data-avatar="ring"
      />
    </Frame>
  )
}

/** The shared shell: the named image, the uploaded picture when it loads, else the generated drawing. */
function Frame({
  type,
  name,
  size,
  picture,
  fallbackRef,
  className,
  style,
  children,
  ...rest
}: Avatar.Base & {
  type: Avatar.Props['type']
  size: number
  picture: string | null
  fallbackRef: (el: Element | null) => void
  children: ReactNode
}) {
  return (
    <BaseAvatar.Root
      {...rest}
      role="img"
      aria-label={name}
      data-type={type}
      data-size={size}
      className={cx(styles.root, className)}
      style={{ ...style, width: size, height: size }}
    >
      {picture ? <BaseAvatar.Image src={picture} alt="" className={styles.image} /> : null}
      <BaseAvatar.Fallback ref={fallbackRef} className={styles.fallback}>
        {children}
      </BaseAvatar.Fallback>
    </BaseAvatar.Root>
  )
}

export namespace Avatar {
  /** What every type shares. `children` are ours (image + fallback); `className` and `style` merge. */
  export interface Base extends Omit<
    BaseAvatar.Root.Props,
    'children' | 'className' | 'style' | 'render' | 'id'
  > {
    /** The accessible name: the user's, project's or workspace's name. */
    name: string
    className?: string
    style?: CSSProperties
  }

  export interface UserProps extends Base {
    type: 'user'
    /** The user's ID: what the face is drawn from, so renaming never changes it. */
    id: string
    /** The user's uploaded picture; null when they have none. */
    image: string | null
    /** Diameter in px; 24 in rows and the sidebar. */
    size?: number
  }

  export interface ProjectProps extends Base {
    type: 'project'
    /** The project's slug: what the marble is drawn from. */
    slug: string
    color: ProjectColor
    /** The project's icon name (any Lucide icon name), drawn on the marble, loaded on demand; null: none. */
    icon: string | null
    /** 18 in the sidebar, 16 in compact lists, 20 in menus, 24 in the settings header, 40 on the project page. */
    size?: 16 | 18 | 20 | 24 | 40
  }

  export interface WorkspaceProps extends Base {
    type: 'workspace'
    /** The workspace's slug: what the pattern is drawn from. */
    slug: string
    /** The workspace's uploaded picture; null when it has none. */
    picture: string | null
    size?: 16 | 20 | 24 | 28 | 40 | 48
  }

  export interface InstanceProps extends Base {
    type: 'instance'
    /** What the ring is drawn from: the instance's address (its host), so it stays the same. */
    seed: string
    size?: 16 | 18 | 20 | 24 | 28 | 40 | 48
  }

  export type Props = UserProps | ProjectProps | WorkspaceProps | InstanceProps
}
