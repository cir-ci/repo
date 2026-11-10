import type { BuildStatus } from './build.ts'
import type { SnoozeKind } from './review.ts'
import type { Undo } from './undo.ts'

export type TriageKind = 'flaky' | 'no_baseline' | 'failed'
export type ReviewRuleKind = 'snapshot-name' | 'build-name'

export namespace Triage {
  /** A problem nobody has dealt with yet, on a team's default branch. */
  export interface Item {
    kind: TriageKind
    /** Identifies the problem within its kind: the snapshot name, or `build:<number>`. */
    key: string
    /** The screenshot it is about; null for a failed build. */
    snapshotName: string | null
    team: { slug: string; name: string }
    build: {
      number: number
      branch: string | null
      commitSha: string
      status: BuildStatus
      /** When the build was made: how long the problem has been waiting. */
      createdAt: string
    }
    /** `auto`: put there by the "assign to whoever is on triage" setting, not by a person. */
    assignee: { id: string; name: string; image: string | null; auto: boolean } | null
    /** When a timed snooze ends; null when not snoozed or snoozed until the next push. */
    snoozedUntil: string | null
    snoozeKind: SnoozeKind | null
    snoozed: boolean
    /**
     * A flaky item's last commits on the default branch (up to 10, oldest first; reruns of a
     * commit are one entry) and whether the screenshot changed in each; empty for the other kinds.
     */
    history: { number: number; changed: boolean }[]
    /** Why a flaky item is flaky ("came back to an earlier image 3 times"); null for the other kinds. */
    reason: string | null
    /** Why a failed build ended in error; null for the other kinds, or when no reason was stored. */
    error: string | null
    /**
     * How many pull requests show a flaky screenshot as changed in their latest build, with the
     * review still pending; 0 for the other kinds.
     */
    blocking: number
  }

  /** `GET …/triage`: the queue (dismissed items left out) and who is on triage. */
  export interface Queue {
    items: Item[]
    rotation: {
      members: { id: string; name: string; image: string | null }[]
      /** Who is on triage this week; null without a rotation. */
      onTriage: { id: string; name: string; image: string | null } | null
      /** When the turn passes on; null without a rotation. */
      until: string | null
    }
  }

  /** The rotation as edited in settings. */
  export interface Rotation {
    /** Any moment of the first week; null when the team has no rotation. */
    startsOn: string | null
    members: { id: string; name: string }[]
  }

  /** `POST …/triage/rerun`: the build, queued to be compared again. */
  export interface Rerun {
    build: { number: number; status: BuildStatus }
  }

  /** `POST …/triage/snooze` and `…/assign` return the item's new state. */
  export interface ItemState extends Undo.Field {
    kind: TriageKind
    key: string
    assigneeId: string | null
    /** Whether the on-triage setting chose the assignee; false once a person did. */
    assigneeAuto: boolean
    snoozeKind: SnoozeKind | null
    snoozedUntil: string | null
    dismissed: boolean
  }
}

export namespace ReviewRule {
  /** Asks its reviewers to review a build when the pattern matches. */
  export interface Item {
    id: string
    kind: ReviewRuleKind
    /** A glob: `*` within a path segment, `**` across them, `?` one character. */
    pattern: string
    position: number
    reviewers: { id: string; name: string }[]
  }

  /** `GET …/rules`. */
  export interface Settings {
    canManage: boolean
    rules: Item[]
    rotation: Triage.Rotation
  }
}

export namespace IgnoreRegion {
  export interface Item {
    id: string
    /** The screenshot name it applies to. */
    name: string
    x: number
    y: number
    width: number
    height: number
    createdAt: string
    /** Who added it; null for the CLI or when the person's account is gone. */
    createdBy: { id: string; name: string } | null
  }

  /** A screenshot name that has regions, with the latest screenshot to draw them on. */
  export interface Snapshot {
    name: string
    regions: number
    latest: {
      buildNumber: number
      sha256: string
      width: number | null
      height: number | null
    } | null
  }

  /** `GET /api/teams/:workspace/:team/ignore-regions`. */
  export interface List {
    regions: Item[]
    snapshots: Snapshot[]
  }
}
