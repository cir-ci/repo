export namespace Issue {
  /** An issue as a build page shows it. */
  export interface Ref {
    key: string
    url: string
    title: string
  }

  /** An issue created from a build (`GET …/builds/:number/issues`). */
  export interface Link extends Ref {
    id: string
    /** The tracker: `linear` or `jira`. */
    tracker: string
    /** The screenshot it was created for; null for the whole build. */
    snapshotName: string | null
    createdAt: string
    createdBy: string | null
  }

  /** A tracker the team files issues in. */
  export interface Tracker {
    integrationId: string
    kind: string
    /** The workspace or site. */
    name: string
    /** The Linear team id or Jira project key issues go to. */
    target: string
  }

  /** `GET /api/teams/:workspace/:team/builds/:number/issues`. */
  export interface List {
    issues: Link[]
    /** Empty when the team has no tracker mapped: the dashboard then hides "Create issue". */
    trackers: Tracker[]
  }

  /** `POST …/builds/:number/issues`. */
  export interface Create {
    integrationId: string
    snapshotName?: string
    title?: string
  }
}
