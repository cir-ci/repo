export namespace Integration {
  /** Mirrors `IntegrationGroup` in `@circi/core` (api depends on nothing); `contract-check.ts` fails if they drift. */
  export type Group = 'git' | 'chat' | 'design' | 'tracker'

  /** One field of a connect form, from the definition's credentials schema. */
  export interface CredentialField {
    name: string
    label: string
    description?: string
    placeholder?: string
    /** Shown as a password field; the value is sealed and never sent back. */
    secret: boolean
    optional: boolean
  }

  /** One setting a mapping has besides its target. */
  export type MappingField =
    | {
        kind: 'events'
        key: string
        label: string
        /** The domain events a person can switch on; `event` is the stored value. */
        options: { event: string; label: string }[]
        /** On for a newly mapped project. */
        defaults: string[]
      }
    | { kind: 'text'; key: string; label: string; placeholder?: string; optional: boolean }
    | { kind: 'toggle'; key: string; label: string; default: boolean }

  /** How a project maps to an integration, from the definition. */
  export interface MappingSpec {
    description?: string
    /** What the target is called (`Channel`, `Team`) and how it is chosen. */
    targetLabel: string
    targetKind: 'text' | 'select' | 'repository'
    targetPlaceholder?: string
    fields: MappingField[]
  }

  /** The links section of a definition (project-wide links such as Figma's snapshot-to-frame table). */
  export interface LinksSpec {
    /** The stored link kind (`figma-frame`). */
    kind: string
    label: string
    description?: string
    /** The column that names what was linked (`Frame`). */
    targetLabel: string
    /** The key of the field that is the link's subject. */
    subject: string
    fields: { key: string; label: string; placeholder?: string; description?: string }[]
    /** Offer "Link automatically". */
    autoLink: boolean
  }

  /** `kind` is the provider (`github`, `slack`…); the catalog lists the possible values. */
  export interface Item {
    id: string
    kind: string
    group: Group
    /** The provider's name (`Slack`), for labels. */
    kindName: string
    /** The account, workspace or installation it is connected to. */
    name: string
    /** CirCI can't use the connection and a person has to act. */
    needsAttention: boolean
    attentionReason: string | null
    /** Projects of the organisation that use it (a repository, channel, team or file each). */
    projectCount: number
    createdAt: string
  }

  /** One provider in the Add dialog. */
  export interface CatalogEntry {
    kind: string
    group: Group
    name: string
    description: string
    status: 'available' | 'planned'
    /** This release has a provider and add flow for it (`available` entries not built say "Coming soon"). */
    built: boolean
    /** Available, and this instance can connect it (GitHub needs a GitHub App configured). */
    connectable: boolean
    /** Key of the logo (`apps/web/src/features/integrations/logos.tsx`); defaults to `kind`. */
    logo: string
    /** The connect form's fields (empty for an OAuth-only or not-yet-generic integration). */
    credentials: CredentialField[]
    /** Connecting goes through the provider's OAuth install instead of (or besides) the form. */
    oauth: boolean
    /** How a project maps to it; null when it has no mapping or is not generic. */
    mapping: MappingSpec | null
    /** The project-wide links it keeps; null when it has none. */
    links: LinksSpec | null
  }

  /** `GET /api/orgs/:org/integrations`. */
  export interface ListResponse {
    canManage: boolean
    integrations: Item[]
    catalog: CatalogEntry[]
  }

  /** `GET /api/orgs/:org/integrations/:kind/install`: where to send the browser to install the app. */
  export interface Install {
    url: string
  }

  /** What a project can be pointed at: a Slack channel, a Linear team, a repository. */
  export interface Target {
    id: string
    /** Stored beside the mapping so the page can show it without asking the provider. */
    name: string
    /** What the picker shows; `name` when absent. */
    label?: string
  }

  /** A project's mapping on an integration. */
  export interface Mapping {
    ref: string
    name: string | null
    extra: Record<string, unknown>
  }

  export interface MappingProject {
    slug: string
    name: string
    mapping: Mapping | null
  }

  /** `GET /api/orgs/:org/integrations/:id/projects`: one integration and how each project maps to it. */
  export interface MappingPage {
    canManage: boolean
    /** The instance can reach the provider (an OAuth app is configured), so reinstalling works. */
    configured: boolean
    integration: {
      id: string
      kind: string
      name: string
      needsAttention: boolean
      attentionReason: string | null
    }
    definition: CatalogEntry
    /**
     * The webhook a git host calls: its address, and the secret to put on it (owners and admins
     * only; null for a host whose webhook secret is configured elsewhere). Null for any other integration.
     */
    webhook: { url: string; secret: string | null } | null
    projects: MappingProject[]
  }

  /** `PUT /api/orgs/:org/integrations/:id/projects/:project`. */
  export interface MappingInput {
    ref: string
    name?: string
    extra?: Record<string, unknown>
  }

  /** One project-wide link of an integration (`GET …/:id/projects/:project/links`). */
  export interface Link {
    id: string
    /** What it is about: the snapshot pattern. */
    subject: string
    /** The integration's own id for the target (a Figma `fileKey:nodeId`). */
    ref: string
    url: string | null
    /** What a person calls the target (the frame's name); null when unknown. */
    title: string | null
    /** `auto`: CirCI matched it by name; `manual`: a person added it. */
    source: 'auto' | 'manual'
    createdAt: string
  }

  export interface LinkList {
    links: Link[]
  }

  /** `POST …/links`: the values of the definition's link fields, by key. */
  export interface LinkInput {
    values: Record<string, string>
  }

  /** `POST …/links/auto`. */
  export interface AutoLinkResult {
    /** Links added now. */
    created: number
    /** Snapshots the project has uploaded that still have no link. */
    unlinked: number
    /** Frames the file has. */
    frames: number
  }
}
