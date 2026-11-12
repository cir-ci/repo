import type { IntegrationCatalog, IntegrationEvent } from '@circi/core'
import type { z } from 'zod'

import { type GitProvider } from '#src/git/provider.ts'
import { type CommandIgnoredReason } from '#src/git/render.ts'
import { type IssueTracker } from '#src/tracker/tracker.ts'

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

  /** Instance-wide settings of the integrations that need one (an OAuth app). One key per kind. */
  export interface InstanceConfig {
    slack?: { clientId: string; clientSecret: string; apiUrl?: string }
    /** The instance's GitHub App (its credentials; installations are the connections). */
    github?: {
      apiUrl: string
      appId: string
      privateKey: string
      webhookSecret: string
      /** Give up on one API request after this long; default 15 s. */
      timeoutMs?: number
    }
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
    /**
     * Replaces a git host's adapter, by definition id (tests fake the host's edge here). What it
     * holds must have the methods the caller uses; `git.provider(ctx)` of the definition returns it.
     */
    gitProviders?: Readonly<Record<string, object>>
    /** Addresses a person types in may point at private networks (`WEBHOOK_ALLOW_PRIVATE_ADDRESSES`). */
    allowPrivateAddresses?: boolean
  }

  /**
   * The connect form, as a zod object. Each field carries `.meta({ label, secret, description,
   * placeholder })`: the form in the dashboard is rendered from them (`credentialFields`).
   * An empty object means there is nothing to type (OAuth only).
   */
  export type Credentials = z.ZodObject<Record<string, z.ZodType>>

  /** What `connect` and an OAuth exchange return: the account, and what to seal and store. */
  export interface ConnectResult {
    /** The provider's id for the account; one workspace connects it once. */
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

  /** A person-visible name for something a project can be pointed at (a channel, a Linear team). */
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
      /** `Channel`, `Project`, `Project`. */
      label: string
      /**
       * `select` offers `listTargets`; `text` takes the id typed in; `repository` is a `select`
       * over the git host's repositories (the `git` capability's `listRepositories`) that falls
       * back to typing `owner/name` when the host cannot list them.
       */
      kind: 'text' | 'select' | 'repository'
      placeholder?: string
      /** An error message for a target that cannot be right, or null. Checked before saving. */
      validate?(ref: string): string | null
      /**
       * A transform for a `text` target, run after `validate` and before anything is stored: turns
       * what was typed (a pasted address) into the stored `ref` and the target's name, checking it
       * with the provider using the opened credentials. Throws `IntegrationError`s (400, 502) or an
       * error `needsAttention` recognises.
       */
      resolve?(
        ref: string,
        input: { credentials: string },
        ctx: Context,
      ): Promise<{ ref: string; name?: string }>
    }
    /**
     * The choices of a `select` target, from the provider, with the integration's opened
     * credentials. A `repository` target needs none: the `git` capability lists them.
     */
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

  /** The connection a webhook delivery is about: its external id, or the start of it (GitLab: `host#`). */
  export type GitConnectionMatch = { externalId: string } | { externalIdPrefix: string }

  /** A repository a delivery names, and which of the workspaces' connections it is on. */
  export interface GitRepo {
    /** The host's name for it: `owner/name`, a GitLab path with namespace. */
    ref: string
    connection: GitConnectionMatch
  }

  /** Who did it on the host: their account id there (matched to a linked CirCI sign-in) and name. */
  export interface GitActor {
    accountId: string
    login: string
  }

  /** What a git host's webhook means, normalised: the one shared handler acts on these. */
  export type GitEvent =
    | {
        /** A pull or merge request was opened or changed. */
        type: 'pull_request'
        repo: GitRepo
        number: number
        /** Its author, as the host says. */
        author: { login: string; accountId?: string } | null
        /** The source commit and branch, for hosts whose builds learn their pull request this way. */
        head?: { sha?: string; branch?: string }
      }
    | {
        /** `/circi approve|reject|rerun` in a comment on a pull request. */
        type: 'command'
        repo: GitRepo
        number: number
        command: 'approve' | 'reject' | 'rerun'
        /** The comment, to react to. */
        commentId?: string
        actor: GitActor
      }
    | {
        /** Approve or Reject pressed on a build's check (GitHub check runs). */
        type: 'check_action'
        action: 'approve' | 'reject'
        checkRunId: string
        /** Where to answer when the person is unknown. */
        repo?: GitRepo
        actor: GitActor
      }

  /** How the one shared handler's verdict is told to the person on the host. */
  export interface GitAnswer {
    event: Extract<GitEvent, { type: 'command' | 'check_action' }>
    /** What happened: done, the person is not a CirCI member of the project, or nothing applied. */
    outcome: 'acted' | 'refused' | 'ignored'
    /** Why nothing applied (with `ignored`). */
    reason?: CommandIgnoredReason
    /** The pull request, when the event itself does not carry it (a check action's build). */
    prNumber?: number
    /** The connection's external id and opened credentials (`undefined` for a connection without any). */
    connection: { externalId: string; credentials: string | undefined }
  }

  export interface GitWebhook {
    /**
     * The delivery's id, to handle it once (GitHub's retries and replays); null when the headers
     * carry none (the delivery is refused). Includes any prefix that keeps hosts apart.
     */
    deliveryId(headers: GitProvider.WebhookHeaders, rawBody: Buffer): string | null
    /** The events a verified delivery's JSON body means; empty for any the host sends that CirCI ignores. */
    events(headers: GitProvider.WebhookHeaders, payload: Record<string, unknown>): GitEvent[]
    /**
     * The secret to put on the host's webhook, for owners and admins to read: derived from the
     * instance secret. Null where it is configured elsewhere (the GitHub App's own).
     */
    secret?(ctx: Context): string | null
  }

  /**
   * A git host: reports a build on its commit and pull request, and tells CirCI about pull
   * requests and commands through a webhook. Everything about the host's API stays behind
   * `GitProvider`; the shared pipeline (the `git-notify` job, the webhook ingress, the repository
   * picker) never knows which host it is.
   */
  export interface Git {
    /** The adapter for this instance; undefined when it cannot work here (no GitHub App configured). */
    provider(ctx: Context): GitProvider | undefined
    webhook: GitWebhook
    /** Answers a command or check action on the host (a reaction or a reply). Failures are logged by the caller. */
    respond(input: GitAnswer, ctx: Context): Promise<void>
  }

  export interface Capabilities {
    /** Posts a message about an event to the mapped channel. Throws; the worker classifies it. */
    chat?: { send(message: ChatMessage, ctx: Context): Promise<void> }
    /** A git host. */
    git?: Git
    /** An issue tracker built from the opened credentials. */
    tracker?: { create(credentials: string, ctx: Context): IssueTracker | undefined }
    /** A design tool: the frames of a file, renders of them and comments on them. */
    design?: Design
  }

  /**
   * A design tool, called with the opened credentials and the project's mapped file (`fileRef`,
   * the mapping's `external_ref`). Calls throw; callers classify them with `needsAttention`.
   */
  export interface Design {
    /** The top-level frames of the file, in page order. */
    listFrames(credentials: string, fileRef: string, ctx: Context): Promise<readonly DesignFrame[]>
    /** Temporary image addresses of frames by node id (null where the tool could not render one). */
    render(
      credentials: string,
      fileRef: string,
      nodeIds: readonly string[],
      ctx: Context,
    ): Promise<Record<string, string | null>>
    /** Comments on a frame; returns the comment's id. */
    comment(
      credentials: string,
      fileRef: string,
      input: { message: string; nodeId?: string },
      ctx: Context,
    ): Promise<string>
    /** The link a frame of the file makes (pure): what automatic linking stores for it. */
    linkFor(fileRef: string, frame: DesignFrame): LinkDraft
  }

  export interface DesignFrame {
    id: string
    name: string
    /** The page it is on. */
    page: string
  }

  /** What a link is stored as (`integration_links`): the integration's own id for it, and its parts. */
  export interface LinkDraft {
    /** The integration's id for what is linked (a Figma `fileKey:nodeId`). */
    ref: string
    url?: string
    /** What a person calls it (the frame's name). */
    title?: string
    /** Anything else the kind needs (`fileKey`, `nodeId`); `source` and `scope` are set by CirCI. */
    payload?: Record<string, unknown>
  }

  /** One input of the form that adds a link. */
  export interface LinkField {
    key: string
    label: string
    placeholder?: string
    description?: string
  }

  /**
   * Project-wide links an integration keeps for a mapped project (Figma: snapshot patterns to
   * frames), stored as `integration_links` rows of `kind`. The generic page renders a table with
   * add and remove, and an optional "Link automatically" button (`autoLink`, which needs the
   * `design` capability and its `linkFor`): CirCI matches the project's snapshots to the file's frames.
   */
  export interface Links {
    /** The stored `integration_links.kind`: `figma-frame`. */
    kind: string
    /** The table's heading. */
    label: string
    description?: string
    /** The add form's inputs, text only. */
    fields: readonly LinkField[]
    /** Which field is the link's subject (the snapshot pattern); unique per project. */
    subject: string
    /** Turns the form's values into the link to store; may check with the provider. Throws `IntegrationError`s. */
    resolve(
      values: Readonly<Record<string, string>>,
      input: { credentials: string; mappingRef: string | null },
      ctx: Context,
    ): Promise<LinkDraft>
    /** Offers "Link automatically". */
    autoLink?: true
    /** The label of the column that names what was linked (`Frame`). */
    targetLabel: string
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
    credentials: S
    /** Whether this instance can connect it now. Default true. */
    available?(ctx: Context): boolean
    /** Connects with the form's values: verifies against the provider and names the account. */
    connect?(input: z.infer<S>, ctx: Context): Promise<ConnectResult>
    /** Connects through the provider's OAuth install. */
    oauth?: OAuth
    /**
     * An app the provider installs on its own site and sends the browser back from (`setup_url`
     * on a GitHub App): turns the query of that return into the connect form's values, or
     * undefined when it carries nothing to connect. The generic `/api/integrations/:kind/setup`
     * route then runs `connect` for the workspace named in the signed `state`.
     */
    setup?(query: Readonly<Record<string, string>>): z.input<S> | undefined
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
    /** Project-wide links it keeps (needs a `mapping`). */
    links?: Links
    /**
     * Rules that keep an external account or a project's mapping to one place. `account`: the same
     * external account connects in ONE workspace of the instance (a second workspace gets
     * a 409). `project`: a project maps to one connection of the kind (`kind`) or to one git host
     * of the group (`group`); mapping to another moves it.
     */
    exclusive?: Exclusive
    /**
     * The connection keeps no secret of its own (GitHub: the App's credentials are instance
     * configuration, the installation id is the external id): nothing is sealed, and capabilities
     * get an empty credentials string.
     */
    secretless?: true
    /**
     * Connecting an account the workspace already has replaces its credentials and clears
     * "needs attention" (a rotated token, a reinstalled App) instead of answering 409.
     */
    replaceOnReconnect?: true
  }

  export interface Exclusive {
    account?: true
    project?: 'kind' | 'group'
  }
}

/** A definition with its credentials schema erased: what the registry stores and hands out. */
export type IntegrationDefinition = IntegrationDefinition.Of<IntegrationDefinition.Credentials>

/** The shape of an `events` mapping field, as a definition declares it. */
export type EventsField = Extract<IntegrationDefinition.MappingField, { kind: 'events' }>
