/* oxlint-disable vitest/no-conditional-tests, vitest/no-conditional-expect -- a contract runs over definitions of different shapes: what applies to one (a connect form, OAuth, a mapping, a git host) is decided once per definition when its tests are registered, and each test then asserts unconditionally. */
import { INTEGRATION_EVENTS, openSecret, sealSecret } from '@circi/core'
import { describe, expect, it } from 'vitest'

import {
  describeDefinition,
  type IntegrationDefinition,
  IntegrationError,
  mappingExtraSchema,
  mappingHandles,
  mappingSpec,
  normalizeExtra,
} from '#src/index.ts'

/**
 * What a definition's contract needs to know about one integration: how to reach its (faked)
 * provider, the credentials that work and the ones that do not, and an error its provider throws
 * when access is gone. The contract itself (`runIntegrationDefinitionContract`) is the same for
 * every definition; this is the only per-kind input.
 */
export interface DefinitionHarness {
  /** A context whose provider edge is faked (`fetch`, `gitProviders`) and accepts `connect.good`. */
  ctx: IntegrationDefinition.Context
  /** A definition with a connect form. */
  connect?: {
    /** Form values the provider accepts. */
    good: Record<string, unknown>
    /** Form values (and the context to try them in) the provider refuses. */
    bad: { input: Record<string, unknown>; ctx?: IntegrationDefinition.Context }
  }
  /** A definition that connects through OAuth: a code the provider accepts and one it refuses. */
  oauth?: { goodCode: string; badCode: string }
  /** An error the provider throws once access is gone: `needsAttention` must say why. */
  revoked: unknown
  /** A chat integration: where and with what credentials it posts. */
  chat?: { ref: string; credentials: string }
  /** Values that must never reach the dashboard's catalog entry (besides the instance secret). */
  secrets: readonly string[]
}

const CAPABILITY_OF_GROUP = {
  git: 'git',
  chat: 'chat',
  tracker: 'tracker',
  design: 'design',
} as const satisfies Record<IntegrationDefinition.Group, keyof IntegrationDefinition.Capabilities>

/**
 * Everything every definition must do, whatever it integrates: connect (verify, name the account,
 * hand back credentials that seal), refuse bad credentials with a typed error, classify provider
 * errors, declare capabilities that match its group, keep mapping settings strict, handle the
 * events it declares (and only those), and keep secrets out of its public catalog entry. Per-kind
 * files keep what is specific to one provider.
 */
export function runIntegrationDefinitionContract(
  def: IntegrationDefinition,
  harness: DefinitionHarness,
): void {
  const { ctx } = harness

  describe(`integration definition contract: ${def.id}`, () => {
    it('has the capability its group names, and no event without a chat to receive it', () => {
      expect(def.capabilities[CAPABILITY_OF_GROUP[def.group]]).toBeDefined()
      if (def.events.length > 0) expect(def.capabilities.chat).toBeDefined()
    })

    it('is connectable one way at least, and the harness covers each way it has', () => {
      expect(def.connect !== undefined || def.oauth !== undefined).toBe(true)
      expect(harness.connect !== undefined).toBe(def.connect !== undefined)
      expect(harness.oauth !== undefined).toBe(def.oauth !== undefined)
    })

    if (def.connect && harness.connect) {
      const { good, bad } = harness.connect

      it('connects: names the account and returns credentials that seal and open', async () => {
        const parsed = def.credentials.parse(good)
        const result = await def.connect?.(parsed, ctx)
        expect(result?.externalId).toBeTruthy()
        expect(result?.displayName).toBeTruthy()
        if (def.secretless) {
          expect(result?.credentials).toBe('')
        } else {
          const credentials = result?.credentials ?? ''
          expect(credentials).not.toBe('')
          const sealed = sealSecret(ctx.authSecret, credentials)
          expect(sealed).not.toContain(credentials)
          expect(openSecret(ctx.authSecret, sealed)).toBe(credentials)
        }
      })

      it('refuses credentials the provider rejects with a typed IntegrationError', async () => {
        const parsed = def.credentials.parse(bad.input)
        const failure = await def.connect?.(parsed, bad.ctx ?? ctx).then(
          () => undefined,
          (err: unknown) => err,
        )
        expect(failure).toBeInstanceOf(IntegrationError)
      })

      it('rejects a form with a missing required field before calling anything', () => {
        const required = Object.keys(def.credentials.shape).filter(
          (key) => !def.credentials.shape[key]?.safeParse(undefined).success,
        )
        for (const key of required) {
          const { [key]: _omitted, ...rest } = good
          expect(def.credentials.safeParse(rest).success).toBe(false)
        }
      })
    }

    if (def.oauth && harness.oauth) {
      const { goodCode, badCode } = harness.oauth

      it('exchanges an OAuth code for the account and credentials, and refuses a bad one', async () => {
        const result = await def.oauth?.exchange(ctx, { code: goodCode, redirectUri: 'x' })
        expect(result?.externalId).toBeTruthy()
        expect(result?.displayName).toBeTruthy()
        expect(
          openSecret(ctx.authSecret, sealSecret(ctx.authSecret, result?.credentials ?? '')),
        ).toBe(result?.credentials)
        const failure = await def.oauth?.exchange(ctx, { code: badCode, redirectUri: 'x' }).then(
          () => undefined,
          (err: unknown) => err,
        )
        expect(failure).toBeInstanceOf(IntegrationError)
        expect(
          new URL(
            def.oauth?.authorizeUrl(ctx, { redirectUri: 'https://x.test/cb', state: 's' }) ?? '',
          ).searchParams.get('state'),
        ).toBe('s')
      })
    }

    it('classifies provider errors: revoked access needs attention, anything else retries', () => {
      expect(def.needsAttention(harness.revoked)).toEqual(expect.any(String))
      expect(def.needsAttention(harness.revoked)).not.toBe('')
      expect(def.needsAttention(new Error('connection reset'))).toBeNull()
      expect(def.needsAttention(undefined)).toBeNull()
      expect(def.needsAttention('boom')).toBeNull()
    })

    describe('mapping and events', () => {
      const mapping = def.mapping

      it('handles exactly the events it declares', () => {
        const everything = (mapping?.fields ?? []).flatMap((f) =>
          f.kind === 'events' ? [[f.key, f.options.map((o) => o.event)] as const] : [],
        )
        const extra = Object.fromEntries(everything)
        for (const event of INTEGRATION_EVENTS) {
          const declared = (def.events as readonly string[]).includes(event)
          if (!declared) expect(mappingHandles(def, extra, event)).toBe(false)
          else if (!mapping?.handles) {
            const offered = everything.some(([, events]) => events.includes(event))
            expect(mappingHandles(def, extra, event)).toBe(offered || everything.length === 0)
          }
        }
      })

      if (def.capabilities.chat && harness.chat) {
        const { ref, credentials } = harness.chat
        it.each(def.events)('sends %s to its chat without throwing', async (type) => {
          await expect(
            def.capabilities.chat?.send(
              {
                event: { type, buildId: 'b1' },
                build: { teamName: 'Web', number: 7, branch: 'main', url: 'https://ci.acme.io/b' },
                reviewer: 'Rae',
                actor: 'Sam',
                target: {
                  ref,
                  extra: normalizeExtra(mapping ?? { target: { label: '', kind: 'text' } }, {}),
                },
                credentials,
              },
              ctx,
            ),
          ).resolves.toBeUndefined()
        })
      }

      if (mapping) {
        it('keeps settings strict: an unknown key is refused, the normalised defaults are accepted', () => {
          const schema = mappingExtraSchema(mapping)
          expect(schema.safeParse({ notAField: 1 }).success).toBe(false)
          const optionalOnly = (mapping.fields ?? []).every(
            (f) => f.kind !== 'text' || f.optional === true,
          )
          if (optionalOnly) {
            expect(schema.safeParse(normalizeExtra(mapping, {})).success).toBe(true)
          }
        })

        it('offers events it handles, and switches on only options it offers', () => {
          for (const f of mapping.fields ?? []) {
            if (f.kind !== 'events') continue
            const offered = f.options.map((o) => o.event)
            for (const o of offered) expect(def.events).toContain(o)
            for (const d of f.defaults) expect(offered).toContain(d)
          }
        })
      }
    })

    if (def.capabilities.git) {
      const { webhook } = def.capabilities.git
      it('ignores a delivery it does not know instead of throwing', () => {
        expect(webhook.events({}, {})).toEqual([])
        expect(
          webhook.events({ 'x-github-event': 'nonsense', 'x-event-key': 'nope' }, { zen: 1 }),
        ).toEqual([])
        const id = webhook.deliveryId({}, Buffer.from('{}'))
        expect(id === null || typeof id === 'string').toBe(true)
      })
    }

    if (def.capabilities.tracker && harness.connect) {
      it('builds no tracker from credentials it cannot read', () => {
        expect(def.capabilities.tracker?.create('not json', ctx)).toBeUndefined()
      })
    }

    it('keeps every secret out of its public catalog entry', () => {
      const entry = describeDefinition(def, ctx)
      const json = JSON.stringify(entry)
      for (const secret of [ctx.authSecret, ...harness.secrets]) {
        expect(secret).not.toBe('')
        expect(json).not.toContain(secret)
      }
      expect(entry.credentials.map((f) => f.name)).toEqual(Object.keys(def.credentials.shape))
      expect(entry.mapping).toEqual(mappingSpec(def.mapping))
      expect(entry.connectable).toBe(def.available ? def.available(ctx) : true)
    })
  })
}
