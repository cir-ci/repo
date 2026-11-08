export namespace Slack {
  /** Mirrors `SlackEvent` in `@circi/core` (api depends on nothing). */
  export type Event = 'review_requested' | 'review_overdue' | 'build_rejected' | 'build_approved'

  export interface Channel {
    id: string
    name: string
    private: boolean
  }

  /** A connected workspace. */
  export interface Workspace {
    id: string
    name: string
    needsAttention: boolean
    attentionReason: string | null
  }

  /** What a project sends to Slack: one channel of one workspace, and which events. */
  export interface ProjectMapping {
    slug: string
    name: string
    integrationId: string | null
    channelId: string | null
    channelName: string | null
    events: Event[]
  }

  /** `GET /api/orgs/:org/integrations/slack`. */
  export interface Page {
    canManage: boolean
    /** The server has a Slack app (`SLACK_CLIENT_ID`), so workspaces can be added. */
    configured: boolean
    workspaces: Workspace[]
    projects: ProjectMapping[]
  }

  /** `PUT /api/orgs/:org/integrations/slack/:id/projects/:project`. */
  export interface MappingInput {
    channelId: string
    channelName: string
    events: Event[]
  }

  /** `GET /api/orgs/:org/integrations/slack/install`. */
  export interface Install {
    url: string
  }
}
