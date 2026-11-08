# Integration SDK

An integration is declared once, as an `IntegrationDefinition`, and listed once in a registry. The
catalog, the HTTP routes, the worker job, the dashboard's connect form and its mapping page all read
that definition. Adding an integration writes **no route, table, migration, job, or page**.

Slack is the exemplar for chat (`packages/integrations/src/slack.ts`); Linear and Jira
(`linear.ts`, `jira.ts`) are the form-connected trackers, Figma (`figma.ts`) is the design tool
with the `links` section, and GitHub, GitLab and Bitbucket (`github.ts`, `gitlab.ts`, `bitbucket.ts`)
are the git hosts with the `git` capability. Read the one closest to what you add next to this document.

**Status.** Every integration is on the SDK. There are no per-kind tables, routes, repositories or
pages: `provider_connections` is gone (migration 0027 moved its rows into `integrations`).

## Adding an integration

Exactly these files:

1. `packages/integrations/src/<id>.ts`: the definition (`export const <id> = defineIntegration({...})`).
2. `packages/integrations/src/registry.ts`: import it and add it to the list in
   `new IntegrationRegistry([github, gitlab, bitbucket, slack, linear, jira, figma, <id>])`. One line.
3. `apps/web/src/features/integrations/logos.tsx`: one entry in `MARKS` keyed by the definition's `logo`.
4. Only if the integration needs an app of its own on this instance (an OAuth client, the GitHub
   App): a key in `IntegrationDefinition.InstanceConfig` (`definition.ts`), the `Config` entry in
   `@circi/config` and its line in `apps/server/src/lifecycle/integration-config.ts`.

Not touched: routes, schema, `INTEGRATION_CATALOG` (that is only for planned tiles), the provider
registry, the worker, the web router. A definition that cannot work (no logo, no way to connect, a
select mapping without `listTargets`, a credential field without a label) throws when the module
loads; `packages/integrations/test/registry.test.ts` checks every registered definition.

Put the provider's HTTP client and pure text builders in `packages/providers` (they are tested with
a fake of the provider's HTTP edge); the definition only wires them to the SDK.

## The definition

`IntegrationDefinition.Of<S>` (namespace types in `definition.ts`):

| Field | What it is |
| --- | --- |
| `id` | The stored `integrations.kind`. Lowercase letters, digits, dashes. Not a CHECK constraint: the registry validates it. |
| `group` | `git`, `chat`, `design` or `tracker`: where it sits in the Add dialog and the list. |
| `name`, `description` | Shown on the tile and in labels. |
| `logo` | Key into the dashboard's `MARKS` table. |
| `credentials` | A zod object. Each field carries `.meta({ label, secret, description, placeholder })`; the connect form is rendered from it. `z.object({})` means nothing to type (OAuth only). |
| `available(ctx)` | Whether this instance can connect it now (an OAuth app is configured). Default true. Feeds the tile's `connectable`. |
| `connect(input, ctx)` | Verifies the form's values with the provider and returns `{ externalId, displayName, credentials }`. Throws `InvalidCredentialsError` (400), `IntegrationUnreachableError` (502) or `IntegrationConflictError` (409); the generic route maps them. `credentials` is the text that is sealed and stored (a token, or JSON for several fields). |
| `oauth` | `{ available, authorizeUrl, exchange }`: the install flow. The generic routes sign the `state`, check it on the callback and store the result. Installing the same account again replaces its credentials and clears "needs attention". |
| `needsAttention(error)` | The reason to show when an error means a person has to act (revoked token, uninstalled app); `null` for anything else (the job retries). |
| `events` | The domain events it handles (below). |
| `capabilities` | Typed optional members: `chat.send(message, ctx)` (the event pipeline), `tracker.create(credentials, ctx)` (an `IssueTracker`: "Create issue" on a build), `design` (`listFrames`, `render`, `comment`, `linkFor`: Figma), `git` (a git host: below). |
| `mapping` | How a project maps (below). Required by `tracker`, `design` and `git`. |
| `links` | Project-wide links it keeps, rendered as a table on the generic page (below). Needs a `mapping`. |
| `exclusive` | `{ account?: true, project?: 'kind' \| 'group' }`. `account`: the same external account connects in ONE organisation of the instance (a second one gets a 409). `project`: a project maps to one connection of the kind (`kind`) or to one git host of the group (`group`); mapping to another moves it. Figma: `account`; Linear and Jira: `project: 'kind'`; the git hosts: both (`group`). |
| `replaceOnReconnect` | Connecting an account the organisation already has replaces its credentials and clears "needs attention" (a rotated token, a reinstalled App) instead of a 409. The git hosts. |
| `secretless` | The connection keeps no secret (GitHub: the App's credentials are instance configuration, the installation id is the external id). Nothing is sealed; capabilities get `''` as credentials. |

`ctx` is `{ authSecret, publicOrigin, config, fetch? }`: the instance, never a database. `fetch`
exists so tests point the provider's client at a fake.

### Mapping

One target per project and integration, stored in `integration_projects.external_ref`, with the
settings below in `extra` (and the target's name in `extra.name`).

- `target`: `{ label, kind: 'text' | 'select' | 'repository', placeholder?, validate?(ref), resolve?(ref, { credentials }, ctx) }`.
  A `select` target needs `listTargets(credentials, ctx)` (the channels, teams or projects the
  account offers). A `repository` target (the git hosts, and only they: it needs the `git`
  capability) is typed as `owner/name`, with the repositories `git.provider(ctx).listRepositories`
  offers as suggestions (the page falls back to plain typing when the host cannot list them); its
  name is the ref. `resolve` is a transform for a typed target: it runs after `validate`, checks the
  value with the provider and returns the `ref` to store and the target's name (Figma turns a pasted
  file address into the file key and reads the file's name). It throws `IntegrationError`s
  (`InvalidInputError` for "that is not usable", 400) or whatever `needsAttention` recognises.
- `fields`: settings besides the target, each rendered as a control: `events` (checkboxes over domain
  events, with `defaults` for a newly mapped project), `text`, `toggle`. The server builds a strict
  zod schema from them and fills defaults.
- `handles(extra, event)`: optional. Default: with an `events` field, the stored list (or the
  defaults); without one, every event the definition handles.

The dashboard gets all of this as plain data (`Integration.CatalogEntry`: credential field specs,
`MappingSpec`), never code.

## Domain events

A closed union in `@circi/core` (`INTEGRATION_EVENTS`): `review.requested`, `review.overdue`,
`build.rejected`, `build.approved`, `build.completed`. A service queues an event once, inside its
transaction:

```ts
await queueIntegrationEvent(tx, { type: 'build.rejected', buildId, reviewerId, reason })
```

It fans out to each integration of the project's organisation that is healthy (not "needs
attention"), whose definition handles the event and whose mapping wants it: one `integration-event`
job each, deduplicated, committed with the change (a transactional outbox: no job if the
transaction rolls back). The worker (`apps/worker/src/jobs/integration-event.ts`) re-reads the
mapping, opens the credentials, calls the capability and, when `needsAttention(error)` returns a
reason, flags the integration and stops; any other error throws and the queue retries.

To add an event: add it to `INTEGRATION_EVENTS` and its label, queue it from the service that causes
it, and list it in the `events` of the definitions that handle it.

## Credentials, OAuth and attention

- Credentials are sealed with the instance secret (`sealSecret`) before storage and never sent to the
  dashboard. The worker and the target-listing route open them and hand the plaintext to the
  definition.
- A form-connected integration: `POST /orgs/:org/integrations/:kind/connect` validates the body with
  `credentials`, calls `connect`, seals, stores (409 on the same account), owners and admins only.
- An OAuth integration: `GET .../:kind/install` returns the provider's address (state binds
  organisation, user and kind); the provider returns to `/api/integrations/:kind/callback`, which
  redirects to the integration's generic page (`?connect=connected`) or back to the list
  (`?connect=denied|failed&kind=`).
- Needs attention: when listing targets or delivering an event fails with an error that
  `needsAttention` recognises, the integration is flagged with that reason. The page shows a banner
  and, for OAuth integrations, a Reinstall button; no events are queued for it until it is
  reconnected.

## Routes (all generic)

```
POST   /orgs/:org/integrations/:kind/connect            connect with the form
GET    /orgs/:org/integrations/:kind/install            OAuth install address
GET    /integrations/:kind/callback                     OAuth callback (under /api)
POST   /integrations/:kind/webhook                      git host webhook (under /api, no session); also POST /webhooks/:kind
GET    /orgs/:org/integrations/:id/targets              what a project can be pointed at (a git host: its repositories)
GET    /orgs/:org/integrations/:id/projects             the integration, its spec, every project's mapping
PUT    /orgs/:org/integrations/:id/projects/:project    map a project
DELETE /orgs/:org/integrations/:id/projects/:project    stop
GET    /orgs/:org/integrations/:id/projects/:project/links           the project's links (members)
POST   /orgs/:org/integrations/:id/projects/:project/links           add one: { values } by field key
DELETE /orgs/:org/integrations/:id/projects/:project/links/:linkId   remove one
POST   /orgs/:org/integrations/:id/projects/:project/links/auto      link by name (`links.autoLink`)
DELETE /orgs/:org/integrations/:id                      remove (any kind; its mappings go with it)

GET    /projects/:org/:project/builds/:number/issues    issues made from a build + the project's trackers
POST   /projects/:org/:project/builds/:number/issues    "Create issue" through the `tracker` capability
```

The dashboard page is `organizations/$org/settings/integrations/$kind/$id`
(`GenericIntegrationPage`); the Add dialog renders `ConnectForm` from the credential specs.

## Links

`integration_links` is the one table for what an integration attaches to a project or build:
`integration_id`, `project_id` and `build_id` (both nullable), `subject` (a snapshot pattern or
name), `kind`, `external_ref`, `url`, `title`, `payload` (jsonb). A row with a project and no build
is project-wide, unique per project, kind and subject (`createIntegrationLink` upserts it). It
replaced `figma_links` and `issue_links` (migration 0026 moved their rows). Two kinds exist:

- `issue`: per build; `external_ref` the issue key, `url`, `title`, `payload.snapshotName`. Written
  by `createIssueFromBuild` after the tracker answered; read by the build detail and the activity.
- `figma-frame`: project-wide; `subject` the snapshot pattern, `external_ref` `fileKey:nodeId`,
  `title` the frame's name, `payload` `{ fileKey, nodeId, source: 'auto' | 'manual', scope }`.

### The `links` section

A definition that keeps project-wide links declares it, and the generic page renders it under each
mapped project: a table (subject, what was linked, how: Auto or Manual, Remove), an add form, and
an optional "Link automatically" button.

```ts
links: {
  kind: 'figma-frame', label: 'Frame links', targetLabel: 'Frame',
  fields: [{ key: 'pattern', label: 'Snapshot name' }, { key: 'url', label: 'Frame address' }],
  subject: 'pattern',          // the field that is the link's subject
  autoLink: true,              // needs the `design` capability
  resolve(values, { credentials, mappingRef }, ctx) // -> { ref, url?, title?, payload? }
}
```

- `resolve` turns the form's values into the link (parsing a pasted address, asking the provider for
  a name); the services store it (`addProjectLink`) with `payload.source: 'manual'`.
- `autoLink` matches the project's snapshot names to `design.listFrames(...)` by name
  (`matchFramesToSnapshots` in `@circi/core`: case and separators ignored, ambiguous names get no
  link, existing links are never replaced) and stores what `design.linkFor(fileRef, frame)` says
  with `source: 'auto'` (`autoLinkProject`).
- Changing a project's target drops the automatic links made for the old one (`payload.scope` is
  the target they were made for); clearing it drops them all; manual ones stay (`mapProject`,
  `unmapProject` in `@circi/services`, which the generic mapping routes call).

## Git hosts

GitHub, GitLab and Bitbucket are definitions with the `git` capability; everything the pipeline does
for a git host reads it, so adding Azure DevOps would be one definition and one registry line.

```ts
git: {
  provider(ctx): GitProvider | undefined      // status/check run, summary comment, verifyWebhook, listRepositories
  webhook: {
    deliveryId(headers, rawBody): string | null   // handled once per id (null: refused)
    events(headers, payload): GitEvent[]          // normalised events, below
    secret?(ctx): string | null                   // shown to owners/admins; absent when configured on the host
  }
  respond(answer, ctx): Promise<void>         // a reaction or a reply on the host
}
```

- **Connection.** One connection is an `integrations` row: GitHub the App installation id (verified
  with GitHub when connecting: a token is minted and the repositories listed, so the App must really
  be installed there; no other organisation may use it), GitLab `<host>#<user id>` of the token's
  principal, Bitbucket the workspace slug. Sealed credentials are the host's JSON (GitLab address and
  token, Bitbucket token and optional username); GitHub keeps none. `needsAttention(error)` turns a
  revoked token or uninstalled App into the reason the dashboard shows (`GitAttentionBanner`); the
  `git-notify` worker flags it, and mapping a project again (or reconnecting) clears it.
- **Mapping.** The project's repository is `integration_projects.external_ref` of its mapping on the
  connection. `exclusive: { account: true, project: 'group' }` keeps one account in one organisation
  and a project on one git host.
- **Pipeline.** The `git-notify` job reads the build's git target (`getGitTarget`), asks the
  definition for its `git.provider(ctx)`, and writes the status and the one summary comment. Which
  kinds are git hosts is `integrationRegistry.gitKinds()`; repository functions that need it take the
  list (`kinds`), the services pass `gitKinds()`.
- **Webhook ingress.** One route, `POST /api/integrations/:kind/webhook` (and the alias
  `POST /webhooks/:kind`, the address installed GitHub Apps already point at), looks the definition up,
  has `git.provider(ctx).verifyWebhook` check the signature or token, claims `deliveryId` once, and
  gives `git.webhook.events` to `handleGitEvents` (`packages/services/src/git-events.ts`), the one
  handler for every host. The events (`GitEvent`): `pull_request` (author, and for hosts that learn it
  this way the source commit and branch), `command` (`/circi approve|reject|rerun` in a comment, with
  the actor's host account id) and `check_action` (Approve or Reject pressed on a GitHub check run).
  The handler remembers authors, links builds to pull requests, reviews or reruns for the member the
  host account belongs to (matched by account id, exactly one member; never by email), and has the
  definition `respond`. A repository is found by `findGitProjects` (the connection by external id, or
  by its prefix for GitLab's `host#`; the repository case-insensitively).
- **Webhook secret.** GitHub's is the App's, configured with `GITHUB_APP_WEBHOOK_SECRET`. GitLab's and
  Bitbucket's are derived from the instance secret (`derivedWebhookSecret(authSecret, kind)`), shown
  with the webhook address on the integration's page to owners and admins.
- **Tests.** A test fakes a host's edge with `Context.gitProviders` (by definition id), or with the
  provider's `fetch`; nothing talks to a real host.

## What stays custom

Nothing is a route, table, job or page of one integration. What is not a definition's business: the
web app's logo artwork (`MARKS`), the provider clients in `packages/providers`, and the planned tiles
of `INTEGRATION_CATALOG` (entries without a definition yet; a kind in both the registry and the
catalog fails the registry test). GitLab and Bitbucket sign-in (auth providers) is `@circi/auth`'s.

## Known gaps

- An organisation can connect several Figma accounts (it used to be one); an account is still
  connectable in one organisation (`exclusive.account`).
- Selecting a `select` target is not checked against `listTargets` when saving (the page only offers
  what the account lists), and a `repository` is not checked against the host's list.
- Linking a project through the project settings page or `circi-admin github link` records the
  installation without asking GitHub (the organisation's Integrations page does verify it).
