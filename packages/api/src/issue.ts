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

  /** A tracker the project files issues in. */
  export interface Tracker {
    integrationId: string
    kind: string
    /** The workspace or site. */
    name: string
    /** The Linear team id or Jira project key issues go to. */
    target: string
  }

  /** `GET /api/projects/:org/:project/builds/:number/issues`. */
  export interface List {
    issues: Link[]
    /** Empty when the project has no tracker mapped: the dashboard then hides "Create issue". */
    trackers: Tracker[]
  }

  /** `POST …/builds/:number/issues`. */
  export interface Create {
    integrationId: string
    snapshotName?: string
    title?: string
  }

  /** A place an issue can go: a Linear team or a Jira project. */
  export interface Target {
    ref: string
    name: string
  }

  /** `GET /api/orgs/:org/integrations/linear|jira`: the connections and where each project files issues. */
  export interface Page {
    canManage: boolean
    connections: { id: string; name: string; needsAttention: boolean }[]
    projects: {
      slug: string
      name: string
      /** The connection the project is mapped to, with the target. */
      integrationId: string | null
      target: string | null
      /** What a person calls the target (the team or project name); null while unmapped. */
      targetName: string | null
    }[]
  }

  /** `POST /api/orgs/:org/integrations/linear`. */
  export interface ConnectLinear {
    apiKey: string
  }

  /** `POST /api/orgs/:org/integrations/jira`. */
  export interface ConnectJira {
    siteUrl: string
    email: string
    apiToken: string
  }
}
