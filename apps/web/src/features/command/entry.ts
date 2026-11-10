import type { Search } from '@circi/api'
import type { ColorMode, Status, TeamColor } from '@circi/ui'

/**
 * What the command menu lists: one `Entry` per row, whatever it is (a page, an item found by
 * search, an action, a choice in a nested list). The model builds them without a DOM; the menu
 * draws them from these fields alone.
 */

/** The glyph of a row; the menu maps each to an icon. `status` and `team` rows carry their own data. */
export type IconKey =
  | 'inbox'
  | 'reviews'
  | 'triage'
  | 'teams'
  | 'insights'
  | 'settings'
  | 'branch'
  | 'image'
  | 'layers'
  | 'alert'
  | 'bell'
  | 'eye'
  | 'sliders'
  | 'status'
  | 'team'
  | 'workspace'
  | 'approve'
  | 'reject'
  | 'comment'
  | 'copy'
  | 'snooze'
  | 'person'
  | 'check'
  | 'theme'
  | 'keyboard'
  | 'sign-out'
  | 'search'
  | 'filter'
  | 'back'
  | 'remove'
  | 'retry'
  | 'open'

/** What a row is: places and items carry a kind label, actions a tinted tile. */
export type EntryKind =
  | 'page'
  | 'team'
  | 'build'
  | 'branch'
  | 'screenshot'
  | 'baseline'
  | 'triage'
  | 'notice'
  | 'review'
  | 'view'
  | 'setting'
  | 'action'
  | 'submenu'
  | 'choice'
  | 'need'
  | 'more'
  | 'widen'
  | 'retry'

/** The kinds a `Show all` chip can narrow a search to (the `kinds` of the search route), plus the commands-only chip. */
export type ChipKind =
  | 'builds'
  | 'branches'
  | 'screenshots'
  | 'baselines'
  | 'triage'
  | 'notices'
  | 'reviews'
  | 'views'
  | 'teams'
  | 'commands'

/** A removable chip in the field: a kind prefix (`#`, `/`, `>`) or a team (`in:web`). */
export type Chip = { type: 'kind'; kind: ChipKind } | { type: 'team'; slug: string; name: string }

/** The nested lists a row with a chevron opens, and the actions of one row. */
export type PageId = 'team' | 'workspace' | 'theme' | 'row' | 'reason' | 'reviewers'

/** What a row's actions work on: what the search result knows about the thing. */
export type Subject =
  | { type: 'build'; workspace: string; team: string; number: number; label: string }
  | {
      type: 'review'
      workspace: string
      team: string
      number: number
      id: string
      label: string
    }
  | {
      type: 'triage'
      workspace: string
      team: string
      kind: Search.Triage['kind']
      key: string
      label: string
    }
  | { type: 'notice'; id: string; read: boolean; label: string }
  | { type: 'link'; label: string }

export type ReviewSubject = Extract<Subject, { type: 'build' | 'review' }>
export type RequestSubject = Extract<Subject, { type: 'review' }>

/** Someone a review can be asked of. */
export interface Reviewer {
  id: string
  name: string
}
export type TriageSubject = Extract<Subject, { type: 'triage' }>
export type NoticeSubject = Extract<Subject, { type: 'notice' }>

/** One thing a row's actions list (⌘.) can do. */
export type RowAction =
  | {
      type: 'review'
      subject: ReviewSubject
      decision: 'approved' | 'rejected'
      /**
       * Which screenshots: some by name, or the ones with no decision yet. Left out: the whole
       * build, replacing earlier decisions.
       */
      names?: string[] | 'undecided'
      /** Why it is rejected; a team that requires one asks for it first. */
      reason?: string
    }
  | { type: 'requestReview'; subject: ReviewSubject; reviewers: Reviewer[] }
  | { type: 'snoozeRequest'; subject: RequestSubject; choice: SnoozeUntil }
  | { type: 'assignMe'; subject: TriageSubject }
  | { type: 'snoozeTriage'; subject: TriageSubject; choice: SnoozeUntil }
  | { type: 'dismissTriage'; subject: TriageSubject }
  | { type: 'read'; subject: NoticeSubject; read: boolean }
  | { type: 'snoozeNotice'; subject: NoticeSubject; choice: SnoozeUntil }
  | { type: 'removeNotice'; subject: NoticeSubject }
  | { type: 'copyLink'; path: string }
  | { type: 'newTab'; path: string }

export type SnoozeUntil = 'tomorrow' | 'next_week'

export interface Peek {
  /** The kind in the pane's header (`Build`, `Triage`, ...). */
  kind: string
  title: string
  /** What happens, or the one line that says what the thing is. */
  lines: string[]
  rows: { label: string; value: string }[]
}

export interface Entry {
  id: string
  group: string
  kind: EntryKind
  label: string
  /** Grey text after the label (the branch of a build, the reason of a triage item). */
  detail?: string
  /** Tertiary text at the end of a place or item row (`Build`, `Team`). Never on an action. */
  kindLabel?: string
  /** A relative time after the kind label (Recent). */
  time?: string
  /** The registry key spec shown as caps (`g i`, `mod+shift+c`). */
  hint?: string
  icon: IconKey
  /** The state glyph of a build row. */
  status?: Status
  /** The tile of a team row. */
  team?: { slug: string; name: string; color: TeamColor; icon: string | null }
  /** A notice that is unread draws a dot on its bell. */
  unread?: boolean
  /** The current choice of a nested list. */
  checked?: boolean
  /** A row that opens a nested list ends with a chevron. */
  chevron?: boolean
  target: Entry.Target
  peek: Peek
  /** Extra words the query also matches (`prefs`, `dark`). */
  keywords?: readonly string[]
  /** Where ⌘↵ and ⌘⇧C act: the page the row goes to. */
  path?: string
  /** What ⌘. lists. */
  subject?: Subject
  /** How well the row matches the typed text (0 to 100); set when a query is typed. */
  score?: number
}

export namespace Entry {
  export type Target =
    | { type: 'path'; path: string }
    | { type: 'key'; key: string }
    | { type: 'theme'; mode: ColorMode }
    | { type: 'page'; page: PageId; subject?: ReviewSubject; action?: RowAction }
    | { type: 'reviewer'; reviewer: Reviewer; subject: ReviewSubject }
    | { type: 'noop' }
    | { type: 'chip'; chip: Chip }
    | { type: 'widen' }
    | { type: 'clear' }
    | { type: 'retry' }
    | { type: 'team'; slug: string }
    | { type: 'workspace'; slug: string }
    | { type: 'signOut' }
    | { type: 'run'; action: RowAction }

  /** The entries of one heading, in the order the list shows them. */
  export interface GroupView {
    id: string
    /** The heading; empty for the best match, which has none. */
    label: string
    entries: Entry[]
  }

  /** What the Enter key does to a row, for the footer. */
  export type Verb = 'Go to' | 'Run' | 'Choose'
}

/** The footer's Enter verb for a row. */
export function verbOf(entry: Entry | undefined): Entry.Verb {
  if (!entry) return 'Go to'
  if (entry.kind === 'action' || entry.kind === 'widen' || entry.kind === 'retry') return 'Run'
  if (entry.kind === 'submenu' || entry.kind === 'choice' || entry.kind === 'more') return 'Choose'
  return 'Go to'
}
