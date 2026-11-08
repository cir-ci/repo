export namespace Figma {
  /** The Figma frame a snapshot is linked to (on `Build.DiffItem`). */
  export interface Frame {
    fileKey: string
    /** The API's `12:34` form. */
    nodeId: string
    /** Opens the frame in Figma. */
    url: string
    /** The frame's name when CirCI has seen it. */
    frameName: string | null
  }

  export type LinkSource = 'auto' | 'manual'

  /** One snapshot-name pattern linked to a frame. */
  export interface Link {
    id: string
    /** A glob over snapshot names (`checkout/*`). */
    snapshotPattern: string
    fileKey: string
    nodeId: string
    frameName: string | null
    url: string
    source: LinkSource
    createdAt: string
  }

  /** A project's Figma file and links on the Figma page. */
  export interface Project {
    slug: string
    name: string
    fileKey: string | null
    fileName: string | null
    fileUrl: string | null
    /** Frames the file had when last read; null when unknown. */
    frameCount: number | null
    /** How many links the project has. */
    linked: number
  }

  export interface Account {
    /** The integration's id, for removing it (`DELETE …/integrations/integration/:id`). */
    id: string
    /** The Figma user the token belongs to: `handle`. */
    name: string
    needsAttention: boolean
    attentionReason: string | null
    createdAt: string
  }

  /** `GET /api/orgs/:org/integrations/figma`; `account` is null until Figma is connected. */
  export interface Page {
    canManage: boolean
    /** This instance can talk to Figma. */
    configured: boolean
    account: Account | null
    projects: Project[]
  }

  /** `GET /api/orgs/:org/integrations/figma/projects/:project/links`. */
  export interface Links {
    links: Link[]
  }

  /** `POST …/auto-link`. */
  export interface AutoLinkResult {
    /** Links added now. */
    created: number
    /** Snapshots seen in the project's builds that have no frame. */
    unlinked: number
    frames: number
  }
}
