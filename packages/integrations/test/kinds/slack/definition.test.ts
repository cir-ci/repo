import type { IntegrationEvent } from '@circi/core'
import { describe, expect, it } from 'vitest'

import {
  credentialFields,
  IntegrationUnreachableError,
  integrationRegistry,
  InvalidCredentialsError,
  mappingHandles,
  mappingSpec,
} from '#src/index.ts'
import type { IntegrationDefinition } from '#src/index.ts'
import { SlackApiError } from '#src/kinds/slack/client.ts'
import { fakeSlack } from '#test/support/fakes.ts'

const slack = integrationRegistry.get('slack')
if (!slack) throw new Error('slack is registered')

const build = { teamName: 'Web', number: 7, branch: 'main', url: 'https://ci.acme.io/b' }
const message = (
  type: IntegrationEvent.Type,
  over: Partial<IntegrationEvent.Payload> = {},
): IntegrationDefinition.ChatMessage => ({
  event: { type, buildId: 'b1', ...over },
  build,
  reviewer: 'Rae',
  actor: 'Sam',
  target: { ref: 'C1', extra: {} },
  credentials: 'xoxb-1',
})

describe('the Slack definition', () => {
  it('connects by OAuth only: no form fields, an install, nothing to type', () => {
    expect(credentialFields(slack.credentials)).toEqual([])
    expect('connect' in slack).toBe(false)
    expect(slack.oauth).toBeDefined()
  })

  it('is connectable only when the instance has a Slack app', () => {
    const { ctx } = fakeSlack()
    expect(slack.available?.(ctx)).toBe(true)
    expect(slack.available?.({ ...ctx, config: {} })).toBe(false)
  })

  it('builds the authorize url and exchanges the code for the workspace and its bot token', async () => {
    const { ctx } = fakeSlack()
    const url = new URL(
      slack.oauth?.authorizeUrl(ctx, { redirectUri: 'https://ci.acme.io/cb', state: 's' }) ?? '',
    )
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('state')).toBe('s')
    expect(await slack.oauth?.exchange(ctx, { code: 'good', redirectUri: 'x' })).toEqual({
      externalId: 'T1',
      displayName: 'Acme',
      credentials: 'xoxb-1',
    })
    await expect(
      slack.oauth?.exchange(ctx, { code: 'bad', redirectUri: 'x' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError)
    const down: IntegrationDefinition.Context = {
      ...ctx,
      fetch: async () => new Response('x', { status: 503 }),
    }
    await expect(
      slack.oauth?.exchange(down, { code: 'good', redirectUri: 'x' }),
    ).rejects.toBeInstanceOf(IntegrationUnreachableError)
  })

  it('classifies a revoked token as needing attention, and nothing else', () => {
    expect(slack.needsAttention(new SlackApiError('token_revoked', 200))).toBe(
      'Slack rejected the token (token_revoked); reinstall the Slack app',
    )
    expect(slack.needsAttention(new SlackApiError('ratelimited', 429))).toBeNull()
    expect(slack.needsAttention(new Error('network'))).toBeNull()
  })

  it('posts a message per event it handles, to the mapped channel', async () => {
    const { ctx, posts } = fakeSlack()
    const chat = slack.capabilities.chat
    if (!chat) throw new Error('slack is a chat integration')
    await chat.send(message('review.requested', { dueAt: '2026-03-10T12:00:00Z' }), ctx)
    await chat.send(message('build.rejected', { reason: 'Logo <overlaps>' }), ctx)
    await chat.send(message('build.approved'), ctx)
    await chat.send(message('review.overdue'), ctx)
    // build.completed is not something Slack tells channels about.
    await chat.send(message('build.completed'), ctx)
    expect(posts.map((p) => p.channel)).toEqual(['C1', 'C1', 'C1', 'C1'])
    expect(posts.map((p) => String(p.text).split(':')[0])).toHaveLength(4)
    expect(JSON.stringify(posts[1])).toContain('Logo &lt;overlaps&gt;')
  })

  it('lists channels by name, private ones marked', async () => {
    const { ctx } = fakeSlack()
    expect(await slack.mapping?.listTargets?.('xoxb-1', ctx)).toEqual([
      { id: 'G1', name: 'alpha', label: 'alpha (private)' },
      { id: 'C2', name: 'zeta', label: '#zeta' },
    ])
  })

  it('validates channel ids and describes its mapping for the dashboard', () => {
    expect(slack.mapping?.target.validate?.('C02WEB1')).toBeNull()
    expect(slack.mapping?.target.validate?.('general')).toMatch(/channel id/)
    expect(mappingSpec(slack.mapping)).toMatchObject({
      targetLabel: 'Channel',
      targetKind: 'select',
      fields: [
        {
          kind: 'events',
          key: 'events',
          defaults: ['review.requested', 'review.overdue', 'build.rejected'],
        },
      ],
    })
  })

  it('sends the defaults (not approvals) to a mapping with no list, and only handled events', () => {
    expect(mappingHandles(slack, {}, 'review.requested')).toBe(true)
    expect(mappingHandles(slack, {}, 'build.approved')).toBe(false)
    expect(mappingHandles(slack, { events: ['build.approved'] }, 'build.approved')).toBe(true)
    expect(mappingHandles(slack, { events: ['build.completed'] }, 'build.completed')).toBe(false)
  })
})
