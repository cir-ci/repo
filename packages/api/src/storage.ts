import type { Team } from './team.ts'

export namespace Storage {
  export type Kind = 'screenshot' | 'diff' | 'thumbnail' | 'site'

  export interface KindUsage {
    kind: Kind
    files: number
    bytes: number
    /** Hosted site versions (only for `site`). */
    versions?: number
  }

  export interface TeamUsage {
    slug: string
    name: string
    color: Team.Color
    icon: string | null
    retentionDays: number
    files: number
    bytes: number
  }

  /**
   * `GET /api/workspaces/:workspace/storage`. Identical files are stored once across builds and
   * teams, so the per-kind and per-team bytes add up to more than `totalBytes`.
   */
  export interface Usage {
    canManage: boolean
    totalBytes: number
    totalFiles: number
    kinds: KindUsage[]
    teams: TeamUsage[]
    /** The retention in days a new team starts with. */
    defaultRetentionDays: number
  }
}
