import { INTEGRATION_GROUPS, type IntegrationEvent } from '@circi/core'

import type { IntegrationDefinition } from './definition.ts'
import { credentialFields } from './public.ts'

const ID_RE = /^[a-z][a-z0-9-]*$/

/** What is wrong with a definition, or an empty list. The registry and its tests both call it. */
export function definitionProblems(def: IntegrationDefinition): string[] {
  const problems: string[] = []
  const bad = (message: string) => problems.push(`${def.id || '(no id)'}: ${message}`)
  if (!ID_RE.test(def.id)) bad('id must be lowercase letters, digits and dashes')
  if (!def.name.trim()) bad('needs a name')
  if (!def.description.trim()) bad('needs a description')
  if (!def.logo.trim()) bad('needs a logo key')
  if (!INTEGRATION_GROUPS.includes(def.group)) bad(`unknown group ${def.group}`)
  if (!def.connect && !def.oauth) bad('needs `connect` or `oauth`: nothing could connect it')
  if (def.connect && !def.oauth && Object.keys(def.credentials.shape).length === 0) {
    bad('connects with a form but its credentials schema has no fields')
  }
  for (const field of credentialFields(def.credentials)) {
    if (!field.label.trim()) bad(`credential field ${field.name} needs a label (.meta({ label }))`)
  }
  if (Object.keys(def.capabilities).length === 0) bad('needs at least one capability')
  if (def.capabilities.chat && def.events.length === 0) bad('a chat integration handles events')
  if (def.events.length > 0 && !def.capabilities.chat) {
    bad('handles events but has no capability that receives them (chat)')
  }
  if (def.mapping?.target.kind === 'select' && !def.mapping.listTargets) {
    bad('a select mapping target needs `listTargets`')
  }
  if (def.mapping?.target.kind === 'repository' && !def.capabilities.git) {
    bad('a repository mapping target needs the `git` capability (it lists the repositories)')
  }
  if (def.capabilities.git && def.mapping?.target.kind !== 'repository') {
    bad('a git host maps projects to repositories: its `mapping.target.kind` is `repository`')
  }
  if (def.capabilities.tracker && !def.mapping)
    bad('a tracker needs a `mapping` (its team or project)')
  if (def.capabilities.design && !def.mapping) bad('a design tool needs a `mapping` (its file)')
  if (def.links) {
    if (!def.mapping) bad('`links` belong to a mapped project: it needs a `mapping`')
    if (!def.links.fields.some((f) => f.key === def.links?.subject)) {
      bad(`links.subject ${def.links.subject} is not one of its fields`)
    }
    if (def.links.autoLink && !def.capabilities.design) {
      bad('links.autoLink needs the `design` capability (its frames)')
    }
  }
  for (const field of def.mapping?.fields ?? []) {
    if (field.kind !== 'events') continue
    const handled: readonly IntegrationEvent.Type[] = def.events
    for (const option of field.options) {
      if (!handled.includes(option.event)) {
        bad(`mapping offers ${option.event}, which the definition does not handle`)
      }
    }
  }
  return problems
}

/**
 * Declares an integration. Returns the definition unchanged (so the file reads as data) after
 * checking it is complete; a definition that cannot work fails when the module loads, not when
 * someone tries it.
 */
export function defineIntegration<S extends IntegrationDefinition.Credentials>(
  def: IntegrationDefinition.Of<S>,
): IntegrationDefinition {
  const problems = definitionProblems(def)
  if (problems.length > 0)
    throw new Error(`Invalid integration definition:\n${problems.join('\n')}`)
  return def
}
