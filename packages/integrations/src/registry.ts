import type { IntegrationEvent } from '@circi/core'

import { bitbucket } from './bitbucket.ts'
import { definitionProblems } from './define.ts'
import type { IntegrationDefinition } from './definition.ts'
import { figma } from './figma.ts'
import { github } from './github.ts'
import { gitlab } from './gitlab.ts'
import { jira } from './jira.ts'
import { linear } from './linear.ts'
import { slack } from './slack.ts'

/**
 * The integrations of this build, by id. Constructing a registry rejects a duplicate id and a
 * definition that cannot work, so the one in use (`integrationRegistry`) fails at load, not at
 * request time. Tests build their own to exercise those rules.
 */
export class IntegrationRegistry {
  readonly #byId = new Map<string, IntegrationDefinition>()

  constructor(definitions: readonly IntegrationDefinition[]) {
    for (const def of definitions) {
      if (this.#byId.has(def.id)) throw new Error(`Duplicate integration id: ${def.id}`)
      const problems = definitionProblems(def)
      if (problems.length > 0) throw new Error(`Invalid integration:\n${problems.join('\n')}`)
      this.#byId.set(def.id, def)
    }
  }

  get(id: string): IntegrationDefinition | undefined {
    return this.#byId.get(id)
  }

  has(id: string): boolean {
    return this.#byId.has(id)
  }

  all(): IntegrationDefinition[] {
    return [...this.#byId.values()]
  }

  /** The ids of the git hosts (definitions with the `git` capability). */
  gitKinds(): string[] {
    return this.all()
      .filter((d) => d.capabilities.git !== undefined)
      .map((d) => d.id)
  }

  /** The definitions that handle an event. */
  handling(event: IntegrationEvent.Type): IntegrationDefinition[] {
    return this.all().filter((d) => d.events.includes(event))
  }
}

/**
 * THE registry. Adding an integration is one line here, next to its import: the definition file is
 * the only other thing to write (docs/integration-sdk.md).
 */
export const integrationRegistry = new IntegrationRegistry([
  github,
  gitlab,
  bitbucket,
  slack,
  linear,
  jira,
  figma,
])
