import { describe, expect, it } from 'vitest'

import { integrationRegistry } from '#src/index.ts'
import { runIntegrationDefinitionContract } from '#test/support/contract.ts'
import { harnesses } from '#test/support/harnesses.ts'

describe('the definition contract harnesses', () => {
  it('has a harness for every definition (a new integration adds one in support/harnesses.ts)', () => {
    expect(Object.keys(harnesses).toSorted()).toEqual(
      integrationRegistry
        .all()
        .map((d) => d.id)
        .toSorted(),
    )
  })
})

for (const def of integrationRegistry.all()) {
  const harness = harnesses[def.id]
  // The guard above names the missing one; the contract of the others still runs.
  if (harness) runIntegrationDefinitionContract(def, harness())
}
