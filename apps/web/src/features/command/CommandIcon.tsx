import {
  Avatar,
  BellIcon,
  BuildingIcon,
  CancelIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  CopyIcon,
  ErrorIcon,
  EyeIcon,
  GitBranchIcon,
  HourglassIcon,
  type IconProps,
  ImageIcon,
  InboxIcon,
  InsightsIcon,
  KeyboardIcon,
  LayersIcon,
  ListChecksIcon,
  ListFilterIcon,
  LogOutIcon,
  RefreshIcon,
  ReviewIcon,
  ReviewsIcon,
  SearchIcon,
  SettingsIcon,
  SlidersIcon,
  StatusIcon,
  SunIcon,
  UserIcon,
  UsersIcon,
} from '@circi/ui'
import type { ComponentType } from 'react'

import type { Entry, IconKey } from './entry.ts'

import styles from './CommandMenu.module.css'

const ICONS: Record<IconKey, ComponentType<IconProps>> = {
  inbox: InboxIcon,
  reviews: ReviewsIcon,
  triage: ListChecksIcon,
  projects: UsersIcon,
  insights: InsightsIcon,
  settings: SettingsIcon,
  branch: GitBranchIcon,
  image: ImageIcon,
  layers: LayersIcon,
  alert: ErrorIcon,
  bell: BellIcon,
  eye: EyeIcon,
  sliders: SlidersIcon,
  status: CheckCircleIcon,
  project: UsersIcon,
  workspace: BuildingIcon,
  approve: CheckIcon,
  reject: CloseIcon,
  comment: ReviewIcon,
  copy: CopyIcon,
  snooze: HourglassIcon,
  person: UserIcon,
  check: CheckIcon,
  theme: SunIcon,
  keyboard: KeyboardIcon,
  'sign-out': LogOutIcon,
  search: SearchIcon,
  filter: ListFilterIcon,
  back: ChevronLeftIcon,
  remove: CancelIcon,
  retry: RefreshIcon,
  open: ChevronRightIcon,
}

/** The kinds that do something when chosen: they get the tinted tile, never a kind label. */
const TILE_KINDS: ReadonlySet<Entry['kind']> = new Set([
  'action',
  'submenu',
  'widen',
  'more',
  'retry',
])

/**
 * The leading mark of a row (16px): the state glyph of a build, the tile of a project, a plain
 * line icon for places and items, and for an action the tinted 24px tile, the one device that
 * says "this does something". All of them are decorative: the row's name says what it is.
 */
export function CommandIcon({ entry }: CommandIcon.Props) {
  if (TILE_KINDS.has(entry.kind)) {
    const Icon = ICONS[entry.icon]
    return (
      <span className={styles.tile} aria-hidden="true">
        <Icon size={14} />
      </span>
    )
  }
  if (entry.status) return <StatusIcon status={entry.status} size={16} decorative />
  if (entry.avatar) {
    return (
      <Avatar
        type="user"
        aria-hidden
        id={entry.avatar.id}
        name={entry.avatar.name}
        image={entry.avatar.image}
        size={16}
      />
    )
  }
  if (entry.project) {
    return (
      <Avatar
        type="project"
        aria-hidden
        slug={entry.project.slug}
        name={entry.project.name}
        color={entry.project.color}
        icon={entry.project.icon}
        size={16}
      />
    )
  }
  const Icon = ICONS[entry.icon]
  return (
    <span className={styles.glyph} data-unread={entry.unread ? '' : undefined} aria-hidden="true">
      <Icon size={16} />
    </span>
  )
}

export namespace CommandIcon {
  export interface Props {
    entry: Entry
  }
}
