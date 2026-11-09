export namespace Site {
  /** A hosted site of a team, with the addresses that open it. */
  export interface Listing {
    name: string
    kind: string
    kindLabel: string
    slug: string
    /** The one custom domain that serves the team's default branch version, if one is set. */
    customDomain: CustomDomain | null
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

  /** A site's custom domain and whether DNS has been seen to point at the server. */
  export interface CustomDomain {
    domain: string
    verified: boolean
    /** When DNS was last seen pointing at the server. */
    verifiedAt: string | null
    /** Where it opens, e.g. `https://storybook.acme.com`. */
    address: string
  }

  /** The answer to a DNS check of a custom domain. */
  export interface DomainCheck {
    domain: string
    verified: boolean
    verifiedAt: string | null
    /** What to fix when it is not verified. */
    error: string | null
  }

  export interface List {
    /** Static site hosting is set up on this instance. */
    configured: boolean
    /** The name a custom domain's CNAME should point at; null when hosting isn't set up. */
    dnsTarget: string | null
    /** Whether the signed-in person may set or remove custom domains (owners and admins). */
    canManage: boolean
    sites: Listing[]
  }
}
