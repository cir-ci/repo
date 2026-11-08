# Integration SDK

An integration is declared once, as an `IntegrationDefinition`, and listed once in a registry. The
catalog, the HTTP routes, the worker job, the dashboard's connect form and its mapping page all read
that definition. Adding an integration writes **no route, table, migration, job, or page**.

Slack is the exemplar (`packages/integrations/src/slack.ts`). Read it next to this document.

## Adding an integration

Exactly these files:

1. `packages/integrations/src/<id>.ts`: the definition (`export const <id> = defineIntegration({...})`).
2. `packages/integrations/src/registry.ts`: import it and add it to the list in
   `new IntegrationRegistry([slack, <id>])`. One line.
3. `apps/web/src/features/integrations/logos.tsx`: one entry in `MARKS` keyed by the definition's `logo`.
4. Only if the integration needs an app of its own on this instance (an OAuth client): a key in
   `IntegrationDefinition.InstanceConfig` (`definition.ts`), the `Config` entry in `@circi/config`
   and its line in `apps/server/src/lifecycle/integration-config.ts`.

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
| `pageStyle` | `generic`: configured on the one generic page. `custom`: keeps its own page (migrating integrations only). |
| `credentials` | A zod object. Each field carries `.meta({ label, secret, description, placeholder })`; the connect form is rendered from it. `z.object({})` means nothing to type (OAuth only). |
| `available(ctx)` | Whether this instance can connect it now (an OAuth app is configured). Default true. Feeds the tile's `connectable`. |
| `connect(input, ctx)` | Verifies the form's values with the provider and returns `{ externalId, displayName, credentials }`. Throws `InvalidCredentialsError` (400), `IntegrationUnreachableError` (502) or `IntegrationConflictError` (409); the generic route maps them. `credentials` is the text that is sealed and stored (a token, or JSON for several fields). |
| `oauth` | `{ available, authorizeUrl, exchange }`: the install flow. The generic routes sign the `state`, check it on the callback and store the result. Installing the same account again replaces its credentials and clears "needs attention". |
| `needsAttention(error)` | The reason to show when an error means a person has to act (revoked token, uninstalled app); `null` for anything else (the job retries). |
| `events` | The domain events it handles (below). |
| `capabilities` | Typed optional members: `chat.send(message, ctx)`, `git`, `tracker`, `design`. Only `chat` is consumed by the pipeline today. |
| `mapping` | How a project maps (below). |
| `links` | Which `integration_links` kinds it writes (documentation). |

`ctx` is `{ authSecret, publicOrigin, config, fetch? }`: the instance, never a database. `fetch`
exists so tests point the provider's client at a fake.

### Mapping

One target per project and integration, stored in `integration_projects.external_ref`, with the
settings below in `extra` (and the target's name in `extra.name`).

- `target`: `{ label, kind: 'text' | 'select', placeholder?, validate?(ref) }`. A `select` target
  needs `listTargets(credentials, ctx)` (the channels, teams or projects the account offers).
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
GET    /orgs/:org/integrations/:id/targets              what a project can be pointed at
GET    /orgs/:org/integrations/:id/projects             the integration, its spec, every project's mapping
PUT    /orgs/:org/integrations/:id/projects/:project    map a project
DELETE /orgs/:org/integrations/:id/projects/:project    stop
DELETE /orgs/:org/integrations/:source/:id              remove (unchanged, any kind)
```

The dashboard page is `organizations/$org/settings/integrations/$kind/$id`
(`GenericIntegrationPage`); the Add dialog renders `ConnectForm` from the credential specs.

## Links

`integration_links` is the one table for what an integration attaches to a project or build:
`integration_id`, `project_id` and `build_id` (both nullable), `subject` (a snapshot pattern or
name), `kind` (`figma-frame`, `issue`), `external_ref`, `url`, `title`, `payload` (jsonb). A row with
a project and no build is project-wide, unique per project, kind and subject (`createIntegrationLink`
upserts it). It replaces `figma_links` and `issue_links`.

## What stays custom

Until its definition exists, an integration keeps its own route file, repository functions and
page: GitHub, GitLab and Bitbucket (git connections, webhooks, `provider_connections`), Linear and
Jira (`issue-trackers.ts`), Figma (`figma.ts`, frame links). They appear in the catalog from the
static list in `@circi/core` (`INTEGRATION_CATALOG`) with `pageStyle: 'custom'`. Migrating one means
writing its definition, registering it, deleting its entry from `INTEGRATION_CATALOG`, its hand-written
route and page, and its `built`/`connectable` lines in `routes/dashboard/integrations.ts`. A kind in
both the registry and `INTEGRATION_CATALOG` fails the registry test.

Some things are not an integration's business and never move into a definition: webhook receivers
that authenticate a git host (they stay routes), the web app's logo artwork, and the provider
clients in `packages/providers`.
