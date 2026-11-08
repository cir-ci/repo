import type { IntegrationCatalog, IntegrationEvent } from '@circi/core'
import type { FigmaClient, GitProvider, IssueTracker } from '@circi/providers'
import type { z } from 'zod'

/**
 * The one description of an integration. A definition file (`slack.ts`) declares everything CirCI
 * needs to offer it: its name and logo, the form that connects it, how it checks it still works,
 * which domain events it handles, what a project maps to, and the typed capabilities (chat, git,
 * tracker, design) it implements. The registry (`registry.ts`) is the only list of definitions;
 * the catalog, the server routes, the worker job and (as plain data, never code) the dashboard
 * all read it. See docs/integration-sdk.md.
 */

export namespace IntegrationDefinition {
  export type Group = IntegrationCatalog.Group

  /** `generic`: configured on the one generic page. `custom`: the integration keeps its own page. */
  export type PageStyle = 'generic' | 'custom'

  /** Instance-wide settings of the integrations that need one (an OAuth app). One key per kind. */
  export interface InstanceConfig {
    slack?: { clientId: string; clientSecret: string; apiUrl?: string }
  }

  /** What a definition's functions get: the instance, never a database. */
  export interface Context {
    /** The instance secret, to open sealed credentials and sign OAuth state. */
    authSecret: string
    /** The dashboard's origin, for links in messages and OAuth redirects. */
    publicOrigin: string
    config: InstanceConfig
    /** Replaces `fetch` for the provider's HTTP calls (tests). */
    fetch?: typeof fetch
  }

  /**
   * The connect form, as a zod object. Each field carries `.meta({ label, secret, description,
   * placeholder })`: the form in the dashboard is rendered from them (`credentialFields`).
   * An empty object means there is nothing to type (OAuth only).
   */
  export type Credentials = z.ZodObject<Record<string, z.ZodType>>

  /** What `connect` and an OAuth exchange return: the account, and what to seal and store. */
  export interface ConnectResult {
    /** The provider's id for the account; one organisation connects it once. */
    externalId: string
    /** What a person calls it (workspace or site name). */
    displayName: string
    /** The text sealed into `integrations.encrypted_credentials`; whatever the definition reads back. */
    credentials: string
  }

  export interface OAuth {
    /** The instance has what OAuth needs (an app's client id and secret). */
    available(ctx: Context): boolean
    /** The address to send the browser to; `state` comes back on the callback. */
    authorizeUrl(ctx: Context, input: { redirectUri: string; state: string }): string
    /** Trades the callback's code for the account and credentials. Throws `IntegrationError`s. */
    exchange(ctx: Context, input: { code: string; redirectUri: string }): Promise<ConnectResult>
  }

  /** A person-visible name for something a project can be pointed at (a channel, a team). */
  export interface Target {
    id: string
    name: string
    label?: string
  }

  /** One setting of a mapping besides its target; becomes a control on the generic mapping page. */
  export type MappingField =
    | {
        kind: 'events'
        key: string
        label: string
        /** Domain events a person can switch on, each with the text beside its checkbox. */
        options: readonly { event: IntegrationEvent.Type; label: string }[]
        /** On for a newly mapped project. */
        defaults: readonly IntegrationEvent.Type[]
      }
    | { kind: 'text'; key: string; label: string; placeholder?: string; optional?: boolean }
    | { kind: 'toggle'; key: string; label: string; default: boolean }

  /**
   * How a project maps to the integration: one target per project, stored in
   * `integration_projects.external_ref`, with the settings of `fields` in `extra` (and the target's
   * name in `extra.name`).
   */
  export interface Mapping {
    description?: string
    target: {
      /** `Channel`, `Team`, `Project`. */
      label: string
      /** `select` offers `listTargets`; `text` takes the id typed in. */
      kind: 'text' | 'select'
      placeholder?: string
      /** An error message for a target that cannot be right, or null. Checked before saving. */
      validate?(ref: string): string | null
    }
    /** The choices of a `select` target, from the provider, with the integration's opened credentials. */
    listTargets?(credentials: string, ctx: Context): Promise<readonly Target[]>
    fields?: readonly MappingField[]
    /**
     * Whether a mapping wants an event. Default: for a definition with an `events` field, the
     * stored list (or the field's defaults); for one without, every event it handles.
     */
    handles?(extra: Record<string, unknown>, event: IntegrationEvent.Type): boolean
  }

  /** What a chat integration is given to say something about a build. */
  export interface ChatMessage {
    event: IntegrationEvent.Payload
    build: { projectName: string; number: number; branch: string | null; url: string }
    /** Who was asked to review, or who decided. */
    reviewer: string | null
    /** Who asked. */
    actor: string | null
    /** The project's mapping: the channel and the settings. */
    target: { ref: string; extra: Record<string, unknown> }
    /** The opened credentials. */
    credentials: string
  }

  export interface Capabilities {
    /** Posts a message about an event to the mapped channel. Throws; the worker classifies it. */
    chat?: { send(message: ChatMessage, ctx: Context): Promise<void> }
    /** A git host (still reached through `provider_connections` until git hosts migrate). */
    git?: { create(ctx: Context): GitProvider | undefined }
    /** An issue tracker built from the opened credentials. */
    tracker?: { create(credentials: string, ctx: Context): IssueTracker | undefined }
    /** A design tool built from the opened credentials. */
    design?: {
      create(
        credentials: string,
        ctx: Context,
      ): Pick<FigmaClient, 'me' | 'getFile' | 'listFrames' | 'getNodeNames'> | undefined
    }
  }

  /** What generic `integration_links` rows an integration writes (documentation, shown in tests). */
  export interface LinkKind {
    /** `figma-frame`, `issue`. */
    kind: string
    description: string
  }

  /**
   * `S` is the credentials schema; the registry holds definitions with `S` erased
   * (`IntegrationDefinition`).
   */
  export interface Of<S extends Credentials> {
    /** The stored `integrations.kind`: lowercase letters, digits and dashes. */
    id: string
    group: Group
    name: string
    description: string
    /** Key into the dashboard's logo table (`apps/web/src/features/integrations/logos.tsx`). */
    logo: string
    /** Where it is configured. Generic definitions get the generic mapping page. */
    pageStyle: PageStyle
    credentials: S
    /** Whether this instance can connect it now. Default true. */
    available?(ctx: Context): boolean
    /** Connects with the form's values: verifies against the provider and names the account. */
    connect?(input: z.infer<S>, ctx: Context): Promise<ConnectResult>
    /** Connects through the provider's OAuth install. */
    oauth?: OAuth
    /**
     * Whether an error from the provider means a person has to act (revoked token, uninstalled
     * app): the reason to show, and the integration is flagged. Null for any other error (the job
     * retries).
     */
    needsAttention(error: unknown): string | null
    /** The domain events it handles; the fan-out skips it for any other. */
    events: readonly IntegrationEvent.Type[]
    capabilities: Capabilities
    mapping?: Mapping
    /** Which `integration_links` kinds it writes. */
    links?: readonly LinkKind[]
  }
}

/** A definition with its credentials schema erased: what the registry stores and hands out. */
export type IntegrationDefinition = IntegrationDefinition.Of<IntegrationDefinition.Credentials>

/** The shape of an `events` mapping field, as a definition declares it. */
export type EventsField = Extract<IntegrationDefinition.MappingField, { kind: 'events' }>
