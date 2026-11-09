import type { Integration } from '@circi/api'
import { INTEGRATION_GROUPS, type IntegrationCatalog } from '@circi/core'
import type { z } from 'zod'

import { INTEGRATION_CATALOG } from './catalog.ts'
import type { IntegrationDefinition } from './definition.ts'

/**
 * The part of a definition the dashboard may see: names, the connect form's fields and the mapping
 * spec, as plain data. Never code, never a secret.
 */

/** The connect form's fields, from the credentials schema's `.meta({ label, secret, … })`. */
export function credentialFields(
  schema: IntegrationDefinition.Credentials,
): Integration.CredentialField[] {
  return Object.entries(schema.shape).map(([name, field]) => credentialField(name, field))
}

function credentialField(name: string, field: z.ZodType): Integration.CredentialField {
  const meta: Record<string, unknown> = Object.assign({}, field.meta())
  const text = (key: string) => (typeof meta[key] === 'string' ? meta[key] : undefined)
  const out: Integration.CredentialField = {
    name,
    label: text('label') ?? '',
    secret: meta.secret === true,
    optional: field.safeParse(undefined).success,
  }
  const description = text('description')
  const placeholder = text('placeholder')
  if (description) out.description = description
  if (placeholder) out.placeholder = placeholder
  return out
}

/** One mapping field as the dashboard gets it. */
function specField(f: IntegrationDefinition.MappingField): Integration.MappingField {
  if (f.kind === 'events') {
    return {
      kind: 'events',
      key: f.key,
      label: f.label,
      options: f.options.map((o) => ({ event: o.event, label: o.label })),
      defaults: [...f.defaults],
    }
  }
  if (f.kind === 'text') {
    const out: Integration.MappingField = {
      kind: 'text',
      key: f.key,
      label: f.label,
      optional: f.optional === true,
    }
    if (f.placeholder) out.placeholder = f.placeholder
    return out
  }
  return { kind: 'toggle', key: f.key, label: f.label, default: f.default }
}

/** The mapping spec as the dashboard gets it. */
export function mappingSpec(
  mapping: IntegrationDefinition.Mapping | undefined,
): Integration.MappingSpec | null {
  if (!mapping) return null
  return {
    ...(mapping.description ? { description: mapping.description } : {}),
    targetLabel: mapping.target.label,
    targetKind: mapping.target.kind,
    ...(mapping.target.placeholder ? { targetPlaceholder: mapping.target.placeholder } : {}),
    fields: (mapping.fields ?? []).map(specField),
  }
}

/** The links section as the dashboard gets it: the form's fields and whether to offer auto-linking. */
export function linksSpec(
  links: IntegrationDefinition.Links | undefined,
): Integration.LinksSpec | null {
  if (!links) return null
  return {
    kind: links.kind,
    label: links.label,
    ...(links.description ? { description: links.description } : {}),
    targetLabel: links.targetLabel,
    subject: links.subject,
    fields: links.fields.map((f) => ({
      key: f.key,
      label: f.label,
      ...(f.placeholder ? { placeholder: f.placeholder } : {}),
      ...(f.description ? { description: f.description } : {}),
    })),
    autoLink: links.autoLink === true,
  }
}

/** A definition's catalog entry: built (it is registered) and connectable on this instance or not. */
export function describeDefinition(
  def: IntegrationDefinition,
  ctx: IntegrationDefinition.Context,
): Integration.CatalogEntry {
  return {
    kind: def.id,
    group: def.group,
    name: def.name,
    description: def.description,
    status: 'available',
    built: true,
    connectable: def.available ? def.available(ctx) : true,
    logo: def.logo,
    credentials: credentialFields(def.credentials),
    oauth: def.oauth !== undefined,
    mapping: mappingSpec(def.mapping),
    links: linksSpec(def.links),
  }
}

/** What a planned entry of the static catalog is as a catalog entry: shown disabled, nothing behind it. */
function plannedEntry(entry: IntegrationCatalog.Entry): Integration.CatalogEntry {
  return {
    ...entry,
    built: false,
    connectable: false,
    logo: entry.kind,
    credentials: [],
    oauth: false,
    mapping: null,
    links: null,
  }
}

/**
 * The catalog the dashboard shows: every definition of the registry, then the planned entries of
 * the static catalog that have no definition yet.
 */
export function buildCatalog(
  definitions: readonly IntegrationDefinition[],
  ctx: IntegrationDefinition.Context,
): Integration.CatalogEntry[] {
  const known = new Set(definitions.map((d) => d.id))
  const entries: Integration.CatalogEntry[] = [
    ...definitions.map((d) => describeDefinition(d, ctx)),
    ...INTEGRATION_CATALOG.filter((e) => !known.has(e.kind)).map(plannedEntry),
  ]
  // Stable by group (git, chat, design, tracker), registry entries before planned ones in a group.
  return entries.toSorted(
    (a, b) => INTEGRATION_GROUPS.indexOf(a.group) - INTEGRATION_GROUPS.indexOf(b.group),
  )
}
