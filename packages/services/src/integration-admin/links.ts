import { globMatches, matchFramesToSnapshots, ValidationError } from '@circi/core'
import { openSecret } from '@circi/core/node'
import { type Database } from '@circi/db'
import { type IntegrationLink, listTeamLinks } from '@circi/db/queries'
import {
  createIntegrationLink,
  deleteAutoLinks,
  getTeamIntegration,
  insertIntegrationLinksIfAbsent,
  listTeamSnapshotNames,
  removeIntegrationTeam,
  removeOtherTeamMappings,
  setIntegrationAttention,
  setIntegrationTeam,
} from '@circi/db/repositories'
import { type IntegrationDefinition, integrationRegistry } from '@circi/integrations'

/**
 * Team-wide integration links (`integration_links` rows of a definition's `links.kind`; Figma's
 * snapshot-pattern-to-frame table) and the mapping they hang on. The definition does the
 * provider's part (`links.resolve`, the `design` capability); these functions open the stored
 * credentials, call it and write the rows.
 */

/** The integration row a function needs: its id and sealed credentials. */
export interface LinkedIntegration {
  id: string
  encryptedCredentials: string | null
}

const label = (definition: IntegrationDefinition) =>
  (definition.mapping?.target.label ?? 'target').toLowerCase()

function openCredentials(
  definition: IntegrationDefinition,
  integration: LinkedIntegration,
  ctx: IntegrationDefinition.Context,
): string {
  const plaintext = integration.encryptedCredentials
    ? openSecret(ctx.authSecret, integration.encryptedCredentials)
    : undefined
  if (!plaintext) {
    throw new ValidationError(`The ${definition.name} credentials cannot be read; connect it again`)
  }
  return plaintext
}

function linksOf(definition: IntegrationDefinition): IntegrationDefinition.Links {
  if (!definition.links) throw new ValidationError(`${definition.name} has no links`)
  return definition.links
}

export namespace addTeamLink {
  export interface Input {
    definition: IntegrationDefinition
    ctx: IntegrationDefinition.Context
    integration: LinkedIntegration
    teamId: string
    /** The form's values by field key. */
    values: Readonly<Record<string, string>>
    createdBy?: string | null
  }
}

/**
 * Adds a link a person typed in: the definition turns the values into the link (checking them with
 * the provider), and the team's link for the same subject, if any, is replaced.
 */
export async function addTeamLink(
  db: Database,
  input: addTeamLink.Input,
): Promise<IntegrationLink.Row> {
  const { definition, ctx } = input
  const links = linksOf(definition)
  const values: Record<string, string> = {}
  for (const f of links.fields) {
    const value = (input.values[f.key] ?? '').trim()
    if (value === '') throw new ValidationError(`${f.key}: ${f.label} is required`)
    if (value.length > (f.key === links.subject ? 200 : 1000)) {
      throw new ValidationError(`${f.key}: too long`)
    }
    values[f.key] = value
  }
  const subject = values[links.subject] ?? ''
  const mapped = await getTeamIntegration(db, input.teamId, input.integration.id)
  const draft = await links.resolve(
    values,
    {
      credentials: openCredentials(definition, input.integration, ctx),
      mappingRef: mapped?.externalRef ?? null,
    },
    ctx,
  )
  return createIntegrationLink(db, {
    integrationId: input.integration.id,
    teamId: input.teamId,
    subject,
    kind: links.kind,
    externalRef: draft.ref,
    url: draft.url ?? null,
    title: draft.title ?? null,
    payload: { ...draft.payload, source: 'manual' },
    createdBy: input.createdBy ?? null,
  })
}

export namespace autoLinkTeam {
  export interface Input {
    definition: IntegrationDefinition
    ctx: IntegrationDefinition.Context
    integration: LinkedIntegration
    teamId: string
    createdBy?: string | null
  }

  export interface Result {
    /** Links added now. */
    created: number
    /** Snapshots the team has uploaded that still have no link. */
    unlinked: number
    /** Frames the mapped file has. */
    frames: number
  }
}

/**
 * Links the team's snapshots to frames of its mapped file by name (`matchFramesToSnapshots`
 * in `@circi/core`): case and separators ignored, then the frame named like the last path
 * segment; ambiguous names get no link. Only snapshots no link covers yet are considered, and an
 * existing link (manual or automatic) is never replaced. The frames come from the definition's
 * `design` capability and each link is what its `linkFor` says.
 */
export async function autoLinkTeam(
  db: Database,
  input: autoLinkTeam.Input,
): Promise<autoLinkTeam.Result> {
  const { definition, ctx, integration } = input
  const links = linksOf(definition)
  const design = definition.capabilities.design
  if (!links.autoLink || !design) {
    throw new ValidationError(`${definition.name} cannot link automatically`)
  }
  const mapped = await getTeamIntegration(db, input.teamId, integration.id)
  if (!mapped) throw new ValidationError(`Choose a ${label(definition)} for this team first`)
  const frames = await design.listFrames(
    openCredentials(definition, integration, ctx),
    mapped.externalRef,
    ctx,
  )
  const [names, existing] = await Promise.all([
    listTeamSnapshotNames(db, input.teamId),
    listTeamLinks(db, input.teamId, links.kind),
  ])
  const uncovered = names.filter(
    (n) => !existing.some((l) => l.subject !== null && globMatches(l.subject, n)),
  )
  const matches = matchFramesToSnapshots(
    frames.map((f) => f.name),
    uncovered,
  )
  const created = await insertIntegrationLinksIfAbsent(
    db,
    matches.flatMap((m) => {
      const frame = frames[m.frameIndex]
      if (!frame) return []
      const draft = design.linkFor(mapped.externalRef, frame)
      return [
        {
          integrationId: integration.id,
          teamId: input.teamId,
          subject: m.snapshotName,
          kind: links.kind,
          externalRef: draft.ref,
          url: draft.url ?? null,
          title: draft.title ?? null,
          payload: { ...draft.payload, source: 'auto', scope: mapped.externalRef },
          createdBy: input.createdBy ?? null,
        },
      ]
    }),
  )
  return { created, unlinked: uncovered.length - created, frames: frames.length }
}

export namespace mapTeam {
  export interface Input {
    definition: IntegrationDefinition
    integrationId: string
    teamId: string
    ref: string
    extra: Record<string, unknown>
  }
}

/**
 * Points a team at a target of the integration. When the definition keeps links, changing to
 * another target drops the automatic links made for the old one (they would point at things that
 * are not there); manual links stay, as a person made them. An `exclusive` definition moves the
 * team: its mapping on any other connection of the kind (a git host: of any git host) goes.
 * Mapping a git host again says the connection works, so its "needs attention" is cleared.
 */
export async function mapTeam(db: Database, input: mapTeam.Input): Promise<void> {
  const { definition } = input
  // One transaction, and the new mapping is written before the old ones are dropped: a team that
  // moves between installations (or git hosts) is never seen with no mapping, and if any step
  // fails it keeps the old one.
  await db.transaction(async (tx) => {
    await setIntegrationTeam(tx, {
      integrationId: input.integrationId,
      teamId: input.teamId,
      externalRef: input.ref,
      extra: input.extra,
    })
    const exclusive = definition.exclusive?.team
    if (exclusive) {
      const kinds =
        exclusive === 'kind'
          ? [definition.id]
          : integrationRegistry
              .all()
              .filter((d) => d.group === definition.group)
              .map((d) => d.id)
      await removeOtherTeamMappings(tx, {
        teamId: input.teamId,
        keepIntegrationId: input.integrationId,
        kinds,
      })
    }
    if (definition.capabilities.git) await setIntegrationAttention(tx, input.integrationId, null)
    if (input.definition.links) {
      await deleteAutoLinks(tx, {
        teamId: input.teamId,
        kind: input.definition.links.kind,
        keepScope: input.ref,
      })
    }
  })
}

/** Stops a team using the integration; its automatic links go, manual ones stay for when a target is chosen again. */
export async function unmapTeam(
  db: Database,
  input: { definition: IntegrationDefinition; integrationId: string; teamId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await removeIntegrationTeam(tx, input.integrationId, input.teamId)
    if (input.definition.links) {
      await deleteAutoLinks(tx, { teamId: input.teamId, kind: input.definition.links.kind })
    }
  })
}
