export namespace Baseline {
  /** The screenshot a new build of the default branch is compared against, under one name. */
  export interface Item {
    /** The screenshot's name. */
    name: string
    /** The name of the build it came from (a project can upload several). */
    buildName: string
    width: number | null
    height: number | null
    /** Stored size of the image; null when it isn't known. */
    sizeBytes: number | null
    fileSha256: string
    thumbnailSha256: string | null
    /** The build that supplied it. */
    buildNumber: number
    commitSha: string
    /** When that build was approved; its finish time when it needed no approval. */
    approvedAt: string
  }

  /** `GET /api/projects/:org/:project/baselines`: the default branch's current baselines. */
  export interface List {
    project: { slug: string; name: string; defaultBranch: string }
    baselines: Item[]
  }
}
