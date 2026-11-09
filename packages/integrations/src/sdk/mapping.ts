import type { IntegrationEvent } from '@circi/core'
import { z } from 'zod'

import type { EventsField, IntegrationDefinition } from './definition.ts'

/**
 * The generic mapping rules, derived from a definition's `mapping.fields`: what a PUT body may
 * hold (`mappingExtraSchema`), and whether a stored mapping wants an event (`mappingHandles`).
 */

/** The zod schema of a mapping's `extra` settings: strict, so an unknown key is a 400. */
export function mappingExtraSchema(mapping: IntegrationDefinition.Mapping) {
  const shape: Record<string, z.ZodType> = {}
  for (const f of mapping.fields ?? []) {
    if (f.kind === 'events') {
      const offered = new Set<unknown>(f.options.map((o) => o.event))
      shape[f.key] = z
        .array(z.custom<IntegrationEvent.Type>((v) => offered.has(v)))
        .max(f.options.length)
        .optional()
    } else if (f.kind === 'text') {
      const text = z.string().trim().max(200)
      shape[f.key] = f.optional ? text.optional() : text.min(1)
    } else {
      shape[f.key] = z.boolean().optional()
    }
  }
  return z.strictObject(shape)
}

/** The `extra` to store: events in the field's own order, toggles and absent events filled with defaults. */
export function normalizeExtra(
  mapping: IntegrationDefinition.Mapping,
  given: Record<string, unknown>,
): Record<string, unknown> {
  const extra: Record<string, unknown> = {}
  for (const f of mapping.fields ?? []) {
    const value = given[f.key]
    if (f.kind === 'events') {
      const chosen = Array.isArray(value) ? value : f.defaults
      extra[f.key] = f.options.map((o) => o.event).filter((e) => chosen.includes(e))
    } else if (f.kind === 'toggle') {
      extra[f.key] = typeof value === 'boolean' ? value : f.default
    } else if (typeof value === 'string' && value !== '') {
      extra[f.key] = value
    }
  }
  return extra
}

const eventsFieldOf = (mapping: IntegrationDefinition.Mapping): EventsField | undefined =>
  mapping.fields?.find((f): f is EventsField => f.kind === 'events')

/** The events a stored mapping sends, from its `extra` (a row without a list sends the defaults). */
export function mappedEvents(
  mapping: IntegrationDefinition.Mapping,
  extra: Record<string, unknown> | null | undefined,
): IntegrationEvent.Type[] | undefined {
  const field = eventsFieldOf(mapping)
  if (!field) return undefined
  const stored = extra?.[field.key]
  if (!Array.isArray(stored)) return [...field.defaults]
  return field.options.map((o) => o.event).filter((e) => stored.includes(e))
}

/** Whether a stored mapping wants an event of a type its definition handles. */
export function mappingHandles(
  def: IntegrationDefinition,
  extra: Record<string, unknown> | null | undefined,
  event: IntegrationEvent.Type,
): boolean {
  if (!def.events.includes(event)) return false
  if (!def.mapping) return true
  if (def.mapping.handles) return def.mapping.handles(extra ?? {}, event)
  return mappedEvents(def.mapping, extra)?.includes(event) ?? true
}
