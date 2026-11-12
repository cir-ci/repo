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

  it('describes only what each kind does today: no sign-in, no design compare, no posting on frames', () => {
    for (const def of integrationRegistry.all()) {
      expect(`${def.id}: ${def.description}`).not.toMatch(/sign-in|sign in|compare|post results/i)
    }
    expect(integrationRegistry.get('figma')?.description).toBe(
      'Link screenshots to Figma frames. The frame shows beside the screenshot in the build review.',
    )
    expect(integrationRegistry.get('github')?.description).toContain('/circi commands')
  })
})

for (const def of integrationRegistry.all()) {
  const harness = harnesses[def.id]
  // The guard above names the missing one; the contract of the others still runs.
  if (harness) runIntegrationDefinitionContract(def, harness())
}
