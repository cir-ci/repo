import type { Integration } from '@circi/api'
import { describe, expect, it } from 'vitest'

import {
  autoLinkSummary,
  canSave,
  connectionLine,
  connectNote,
  credentialsComplete,
  credentialValues,
  extraToSend,
  initialExtra,
  isDirty,
  linkValuesComplete,
  mappingSummary,
  repositoryRows,
  targetItems,
} from '#features/integrations/api/generic.ts'

const events: Integration.MappingField = {
  kind: 'events',
  key: 'events',
  label: 'Events',
  options: [
    { event: 'review.requested', label: 'Review requested' },
    { event: 'build.rejected', label: 'Build rejected' },
    { event: 'build.approved', label: 'Build approved' },
  ],
  defaults: ['review.requested', 'build.rejected'],
}
const spec: Integration.MappingSpec = {
  targetLabel: 'Channel',
  targetKind: 'select',
  fields: [
    events,
    { kind: 'text', key: 'prefix', label: 'Prefix', optional: true },
    { kind: 'toggle', key: 'threads', label: 'Threads', default: true },
  ],
}

describe('connectNote', () => {
  it('says how an install ended, naming the integration', () => {
    expect(connectNote('connected', 'Slack')).toEqual({
      tone: 'success',
      text: 'Slack is connected. Choose what each team uses.',
    })
    expect(connectNote('denied', 'Slack')?.text).toContain('cancelled')
    expect(connectNote('failed', 'Slack')?.tone).toBe('danger')
    expect(connectNote(undefined, 'Slack')).toBeNull()
    expect(connectNote('other', 'Slack')).toBeNull()
  })
})

describe('credentials', () => {
  const fields: Integration.CredentialField[] = [
    { name: 'site', label: 'Site', secret: false, optional: false },
    { name: 'note', label: 'Note', secret: false, optional: true },
    { name: 'token', label: 'Token', secret: true, optional: false },
  ]

  it('is complete when every required field has a value', () => {
    expect(credentialsComplete(fields, { site: 'a', token: 'b' })).toBe(true)
    expect(credentialsComplete(fields, { site: 'a', token: '  ' })).toBe(false)
    expect(credentialsComplete([], {})).toBe(true)
  })

  it('sends trimmed values and leaves out an empty optional one', () => {
    expect(credentialValues(fields, { site: ' a ', token: 'b', note: ' ' })).toEqual({
      site: 'a',
      token: 'b',
    })
    expect(credentialValues(fields, { site: 'a', token: 'b', note: 'n' }).note).toBe('n')
  })
})

describe('mapping settings', () => {
  it('start from what is saved, or the field defaults', () => {
    expect(initialExtra(spec.fields, null)).toEqual({
      events: ['review.requested', 'build.rejected'],
      prefix: '',
      threads: true,
    })
    expect(
      initialExtra(spec.fields, { events: ['build.approved'], prefix: 'ci', threads: false }),
    ).toEqual({ events: ['build.approved'], prefix: 'ci', threads: false })
  })

  it('send text only when filled', () => {
    expect(
      extraToSend(spec.fields, { events: ['build.approved'], prefix: ' ', threads: false }),
    ).toEqual({
      events: ['build.approved'],
      threads: false,
    })
    expect(extraToSend(spec.fields, { events: [], prefix: ' ci ', threads: true }).prefix).toBe(
      'ci',
    )
  })

  it('can be saved with a target and every required text field', () => {
    expect(canSave(spec, 'C1', {})).toBe(true)
    expect(canSave(spec, ' ', {})).toBe(false)
    const required: Integration.MappingSpec = {
      ...spec,
      fields: [{ kind: 'text', key: 'k', label: 'K', optional: false }],
    }
    expect(canSave(required, 'C1', { k: '' })).toBe(false)
    expect(canSave(required, 'C1', { k: 'x' })).toBe(true)
  })

  it('summarise the chosen events', () => {
    expect(mappingSummary(spec, { events: ['review.requested', 'build.rejected'] })).toBe(
      'Review requested, Build rejected',
    )
    expect(mappingSummary(spec, { events: [] })).toBe('No events')
    expect(mappingSummary(spec, {})).toBe('Review requested, Build rejected')
    expect(mappingSummary({ ...spec, fields: [] }, {})).toBeNull()
  })
})

describe('targetItems', () => {
  it('labels targets as the definition says, and keeps a saved one that is gone', () => {
    const targets = [
      { id: 'C1', name: 'web', label: '#web' },
      { id: 'G1', name: 'design' },
    ]
    expect(targetItems(targets, null)).toEqual([
      { value: 'C1', label: '#web', name: 'web' },
      { value: 'G1', label: 'design', name: 'design' },
    ])
    expect(targetItems(targets, { ref: 'C9', name: 'old' })[0]).toEqual({
      value: 'C9',
      label: 'old',
      name: 'old',
    })
    expect(targetItems(targets, { ref: 'C1', name: 'web' })).toHaveLength(2)
  })
})

describe('links', () => {
  const links: Integration.LinksSpec = {
    kind: 'figma-frame',
    label: 'Frame links',
    targetLabel: 'Frame',
    subject: 'pattern',
    autoLink: true,
    fields: [
      { key: 'pattern', label: 'Snapshot name' },
      { key: 'url', label: 'Frame address' },
    ],
  }

  it('wants a value for every field of the add form', () => {
    expect(linkValuesComplete(links, { pattern: 'cart', url: 'https://f/1' })).toBe(true)
    expect(linkValuesComplete(links, { pattern: 'cart', url: '  ' })).toBe(false)
    expect(linkValuesComplete(links, {})).toBe(false)
  })

  it('says what a run of "Link automatically" did', () => {
    expect(autoLinkSummary({ created: 2, unlinked: 0, frames: 5 })).toBe(
      'Linked 2 snapshots to frames.',
    )
    expect(autoLinkSummary({ created: 1, unlinked: 3, frames: 5 })).toBe(
      'Linked 1 snapshot to frames; 3 snapshots have no frame with a matching name.',
    )
    expect(autoLinkSummary({ created: 0, unlinked: 1, frames: 0 })).toBe(
      'No new frames linked; 1 snapshot has no frame with a matching name.',
    )
  })
})

const channelSpec: Integration.MappingSpec = {
  targetLabel: 'Channel',
  targetKind: 'select',
  fields: [events],
}

describe('isDirty', () => {
  const dirtySpec = channelSpec
  const saved: Integration.Mapping = {
    ref: 'C1',
    name: 'a',
    extra: { events: ['review.requested'] },
  }

  it('is clean until the target or a setting changes', () => {
    expect(isDirty(dirtySpec, saved, 'C1', initialExtra(dirtySpec.fields, saved.extra))).toBe(false)
    expect(isDirty(dirtySpec, saved, 'C2', initialExtra(dirtySpec.fields, saved.extra))).toBe(true)
    expect(
      isDirty(dirtySpec, saved, 'C1', { events: ['review.requested', 'build.rejected'] }),
    ).toBe(true)
  })

  it('treats an unsaved row as dirty once it has a target', () => {
    expect(isDirty(dirtySpec, null, '', initialExtra(dirtySpec.fields, null))).toBe(false)
    expect(isDirty(dirtySpec, null, 'C1', initialExtra(dirtySpec.fields, null))).toBe(true)
  })
})

const team = (slug: string, ref?: string): Integration.MappingTeam => ({
  slug,
  name: slug,
  mapping: ref ? { ref, name: ref, extra: {} } : null,
})

describe('repositoryRows', () => {
  const targets = [
    { id: 'acme/www', name: 'acme/www' },
    { id: 'acme/web', name: 'acme/web' },
  ]

  it('lists the host’s repositories with their teams, mapped ones first', () => {
    expect(repositoryRows([team('web', 'acme/web'), team('www')], targets)).toEqual([
      { ref: 'acme/web', label: 'acme/web', team: 'web', broken: false },
      { ref: 'acme/www', label: 'acme/www', team: null, broken: false },
    ])
  })

  it('flags a mapped repository the host no longer lists, only when the list loaded', () => {
    const teams = [team('old', 'acme/gone')]
    expect(repositoryRows(teams, targets)[0]).toEqual({
      ref: 'acme/gone',
      label: 'acme/gone',
      team: 'old',
      broken: true,
    })
    expect(repositoryRows(teams, null)).toEqual([
      { ref: 'acme/gone', label: 'acme/gone', team: 'old', broken: false },
    ])
  })
})

const t = (ref: string | null): Integration.MappingTeam => ({
  slug: 'x',
  name: 'x',
  mapping: ref ? { ref, name: null, extra: {} } : null,
})

describe('connectionLine', () => {
  it('says what it is connected to and how many teams use it', () => {
    expect(connectionLine('Slack', 'Acme', [t(null)])).toBe('Slack · Acme · no teams use it yet')
    expect(connectionLine('Slack', 'Acme', [t('a')])).toBe('Slack · Acme · 1 team uses it')
    expect(connectionLine('Slack', 'Acme', [t('a'), t('b')])).toBe('Slack · Acme · 2 teams use it')
  })
})
