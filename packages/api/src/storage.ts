import type { Project } from './project.ts'

export namespace Storage {
  export type Kind = 'screenshot' | 'diff' | 'thumbnail' | 'site'

  export interface KindUsage {
    kind: Kind
    files: number
    bytes: number
    /** Hosted site versions (only for `site`). */
    versions?: number
  }

  export interface ProjectUsage {
    slug: string
    name: string
    color: Project.Color
    icon: string | null
    retentionDays: number
    files: number
    bytes: number
  }

  /**
   * `GET /api/workspaces/:workspace/storage`. Identical files are stored once across builds and
   * projects, so the per-kind and per-project bytes add up to more than `totalBytes`.
   */
  export interface Usage {
    canManage: boolean
    totalBytes: number
    totalFiles: number
    kinds: KindUsage[]
    projects: ProjectUsage[]
    /** The retention in days a new project starts with. */
    defaultRetentionDays: number
  }
}
