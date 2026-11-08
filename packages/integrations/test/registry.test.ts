import { INTEGRATION_CATALOG, INTEGRATION_GROUPS } from '@circi/core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  buildCatalog,
  credentialFields,
  defineIntegration,
  definitionProblems,
  type IntegrationDefinition,
  IntegrationRegistry,
  integrationRegistry,
  mappedEvents,
  mappingExtraSchema,
  mappingHandles,
  normalizeExtra,
  resolveKind,
} from '#src/index.ts'

const ctx: IntegrationDefinition.Context = {
  authSecret: 'a-long-instance-secret-for-tests-0123456789',
  publicOrigin: 'https://ci.acme.io',
  config: {},
}

/** A complete token-based chat definition; tests override what they probe. */
const token = (over: Partial<IntegrationDefinition.Of<z.ZodObject<{ token: z.ZodString }>>> = {}) =>
  defineIntegration({
    id: 'testchat',
    group: 'chat',
    name: 'Test chat',
    description: 'A chat for tests.',
    logo: 'testchat',
    credentials: z.object({
      token: z.string().meta({ label: 'Token', secret: true, description: 'From the settings' }),
    }),
    connect: async (input) => ({
      externalId: 'acct',
      displayName: 'Acct',
      credentials: input.token,
    }),
    needsAttention: () => null,
    events: ['build.rejected', 'build.approved'],
    capabilities: { chat: { send: async () => {} } },
    mapping: {
      target: { label: 'Room', kind: 'text' },
      fields: [
        {
          kind: 'events',
          key: 'events',
          label: 'Events',
          options: [
            { event: 'build.rejected', label: 'Rejected' },
            { event: 'build.approved', label: 'Approved' },
          ],
          defaults: ['build.rejected'],
        },
      ],
    },
    ...over,
  })

describe('the registry', () => {
  it('rejects duplicate ids', () => {
    expect(() => new IntegrationRegistry([token(), token()])).toThrow(
      /Duplicate integration id: testchat/,
    )
  })

  it('rejects a definition that could not work', () => {
    expect(() => token({ logo: '' })).toThrow(/needs a logo key/)
    expect(() => token({ id: 'Bad Id' })).toThrow(/lowercase/)
    expect(() => token({ credentials: z.object({ token: z.string() }) })).toThrow(/needs a label/)
    expect(() => token({ capabilities: {} })).toThrow(/at least one capability/)
    expect(() => token({ events: [] })).toThrow(/handles events/)
    expect(() => token({ mapping: { target: { label: 'Room', kind: 'select' } } })).toThrow(
      /listTargets/,
    )
    const noConnect = { ...token() }
    delete noConnect.connect
    expect(definitionProblems(noConnect)).toEqual([
      'testchat: needs `connect` or `oauth`: nothing could connect it',
    ])
  })

  it('checks the links, tracker and design rules', () => {
    const links: IntegrationDefinition.Links = {
      kind: 'thing',
      label: 'Things',
      targetLabel: 'Thing',
      subject: 'name',
      fields: [{ key: 'name', label: 'Name' }],
      resolve: async () => ({ ref: 'x' }),
    }
    // `links` hang on a mapped project, and their subject is one of their fields.
    expect(() => token({ links, mapping: undefined })).toThrow(/needs a `mapping`/)
    expect(() => token({ links: { ...links, subject: 'other' } })).toThrow(/not one of its fields/)
    // Automatic linking needs frames to match against.
    expect(() => token({ links: { ...links, autoLink: true } })).toThrow(/needs the `design`/)
    expect(() =>
      token({
        events: [],
        capabilities: { tracker: { create: () => undefined } },
        mapping: undefined,
      }),
    ).toThrow(/tracker needs a `mapping`/)
    expect(() =>
      token({
        events: [],
        capabilities: {
          design: {
            listFrames: async () => [],
            render: async () => ({}),
            comment: async () => '',
            linkFor: () => ({ ref: 'x' }),
          },
        },
        mapping: undefined,
      }),
    ).toThrow(/design tool needs a `mapping`/)
  })

  it('looks definitions up and finds the ones that handle an event', () => {
    const registry = new IntegrationRegistry([token()])
    expect(registry.get('testchat')?.name).toBe('Test chat')
    expect(registry.has('nope')).toBe(false)
    expect(registry.handling('build.approved').map((d) => d.id)).toEqual(['testchat'])
    expect(registry.handling('review.overdue')).toEqual([])
  })
})

describe('every registered definition', () => {
  const definitions = integrationRegistry.all()

  it('is complete: name, description, group, logo, and a label for each credential field', () => {
    expect(definitions.length).toBeGreaterThan(0)
    for (const def of definitions) {
      expect(definitionProblems(def)).toEqual([])
      expect(def.name).not.toBe('')
      expect(INTEGRATION_GROUPS).toContain(def.group)
      expect(def.logo).not.toBe('')
      for (const field of credentialFields(def.credentials)) expect(field.label).not.toBe('')
    }
  })

  it('has an id that is not also a static catalog entry (a migrated integration leaves it)', () => {
    const staticKinds = new Set(INTEGRATION_CATALOG.map((e) => e.kind))
    for (const def of definitions) expect(staticKinds.has(def.id)).toBe(false)
  })
})

describe('the catalog', () => {
  it('is derived from the registry: built and connectable come from the definitions', () => {
    const registry = new IntegrationRegistry([
      token(),
      token({ id: 'other', name: 'Other', available: () => false }),
    ])
    const catalog = buildCatalog(registry.all(), ctx)
    expect(catalog.find((e) => e.kind === 'testchat')).toMatchObject({
      name: 'Test chat',
      group: 'chat',
      status: 'available',
      built: true,
      connectable: true,
      logo: 'testchat',
      oauth: false,
      credentials: [
        {
          name: 'token',
          label: 'Token',
          secret: true,
          optional: false,
          description: 'From the settings',
        },
      ],
      mapping: { targetLabel: 'Room', targetKind: 'text' },
    })
    expect(catalog.find((e) => e.kind === 'other')).toMatchObject({
      built: true,
      connectable: false,
    })
  })

  it('keeps the planned tiles and the static entries without a definition, once each', () => {
    const catalog = buildCatalog(integrationRegistry.all(), ctx)
    const kinds = catalog.map((e) => e.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
    for (const planned of INTEGRATION_CATALOG.filter((e) => e.status === 'planned')) {
      expect(catalog.find((e) => e.kind === planned.kind)).toMatchObject({
        built: false,
        connectable: false,
      })
    }
    expect(catalog.find((e) => e.kind === 'slack')).toMatchObject({ built: true, group: 'chat' })
    // Grouped in the canvas order.
    const order = catalog.map((e) => INTEGRATION_GROUPS.indexOf(e.group))
    expect(order).toEqual(order.toSorted((a, b) => a - b))
  })

  it('resolves stored kinds from the registry, then the static catalog', () => {
    expect(resolveKind(integrationRegistry, 'slack')).toEqual({
      group: 'chat',
      name: 'Slack',
    })
    expect(resolveKind(integrationRegistry, 'github')).toEqual({ group: 'git', name: 'GitHub' })
    expect(resolveKind(integrationRegistry, 'nope')).toBeUndefined()
  })
})

describe('credential fields', () => {
  it('come from the zod schema: label, secret flag, description, optional', () => {
    const schema = z.object({
      site: z.string().meta({ label: 'Site', placeholder: 'acme.example.com' }),
      key: z.string().meta({ label: 'Key', secret: true }),
      note: z.string().optional().meta({ label: 'Note' }),
    })
    expect(credentialFields(schema)).toEqual([
      {
        name: 'site',
        label: 'Site',
        placeholder: 'acme.example.com',
        secret: false,
        optional: false,
      },
      { name: 'key', label: 'Key', secret: true, optional: false },
      { name: 'note', label: 'Note', secret: false, optional: true },
    ])
  })
})

describe('mapping rules', () => {
  const mapping = token().mapping
  if (!mapping) throw new Error('fixture has a mapping')

  it('sends the defaults when the mapping has no list, and keeps the stored list in field order', () => {
    expect(mappedEvents(mapping, { name: 'x' })).toEqual(['build.rejected'])
    expect(mappedEvents(mapping, null)).toEqual(['build.rejected'])
    expect(
      mappedEvents(mapping, { events: ['build.approved', 'nonsense', 'build.rejected'] }),
    ).toEqual(['build.rejected', 'build.approved'])
    expect(mappedEvents(mapping, { events: [] })).toEqual([])
  })

  it('wants an event only if the definition handles it and the mapping lists it', () => {
    const def = token()
    expect(mappingHandles(def, { events: ['build.approved'] }, 'build.approved')).toBe(true)
    expect(mappingHandles(def, { events: ['build.approved'] }, 'build.rejected')).toBe(false)
    expect(mappingHandles(def, {}, 'build.rejected')).toBe(true)
    expect(mappingHandles(def, { events: ['review.overdue'] }, 'review.overdue')).toBe(false)
  })

  it('lets a definition decide for itself with `handles`', () => {
    const def = token({
      mapping: {
        target: { label: 'Room', kind: 'text' },
        handles: (extra, event) => extra.all === true || event === 'build.approved',
      },
    })
    expect(mappingHandles(def, {}, 'build.approved')).toBe(true)
    expect(mappingHandles(def, {}, 'build.rejected')).toBe(false)
    expect(mappingHandles(def, { all: true }, 'build.rejected')).toBe(true)
  })

  it('validates settings strictly and stores them normalised', () => {
    const schema = mappingExtraSchema(mapping)
    expect(schema.safeParse({ events: ['build.approved'] }).success).toBe(true)
    expect(schema.safeParse({ events: ['spam'] }).success).toBe(false)
    expect(schema.safeParse({ other: 1 }).success).toBe(false)
    expect(normalizeExtra(mapping, { events: ['build.approved', 'build.rejected'] })).toEqual({
      events: ['build.rejected', 'build.approved'],
    })
    expect(normalizeExtra(mapping, {})).toEqual({ events: ['build.rejected'] })
  })
})
