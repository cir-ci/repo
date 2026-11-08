export namespace Site {
  /** A hosted site of a team, with the addresses that open it. */
  export interface Listing {
    name: string
    kind: string
    kindLabel: string
    slug: string
    /** Branches that have an address: the newest first, each serving the version it names. */
    branches: { branch: string; address: string; commitSha: string; updatedAt: string }[]
    /** Recent uploads, newest first. */
    versions: {
      commitSha: string
      branch: string | null
      createdAt: string
      totalBytes: number
      address: string | null
    }[]
  }

  export interface List {
    /** Static site hosting is set up on this instance. */
    configured: boolean
    sites: Listing[]
  }
}
