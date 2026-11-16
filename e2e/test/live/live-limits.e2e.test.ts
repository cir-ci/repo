import { afterAll, describe, expect, it } from 'vitest'

import { addMemberViaCli, createUserViaCli, newAccount, signIn } from '#clients/admin.ts'
import { LiveStream } from '#clients/live.ts'
import { useStack } from '#stack/vitest.ts'

/** The stream caps: five per person (the oldest makes room) and `LIVE_MAX_STREAMS` per process. */
describe('live updates: stream caps', () => {
  const ctx = useStack({ dedicated: true, setup: true, env: { LIVE_MAX_STREAMS: '6' } })
  const streams: LiveStream[] = []
  afterAll(() => {
    for (const stream of streams) stream.close()
  })

  const open = async (...args: Parameters<typeof LiveStream.open>) => {
    const stream = await LiveStream.open(...args)
    streams.push(stream)
    return stream
  }
  const person = async (label: string) => {
    const account = await createUserViaCli(ctx.stack, { account: newAccount(label) })
    await addMemberViaCli(ctx.stack, ctx.setup.workspace.slug, account.email, 'member')
    return signIn(ctx.stack, account.email, account.password)
  }

  it('a sixth stream of one person ends the oldest, the other five stay', async () => {
    const session = await person('many')
    const mine: LiveStream[] = []
    for (let i = 0; i < 5; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- each stream is registered before the next opens
      mine.push(await open(session))
    }
    expect(mine.map((s) => s.status)).toEqual([200, 200, 200, 200, 200])
    expect(mine.map((s) => s.ended)).toEqual([false, false, false, false, false])

    const sixth = await open(session)
    expect(sixth.status).toBe(200)
    await mine[0]!.waitForEnd(5_000)
    expect(mine.slice(1).map((s) => s.ended)).toEqual([false, false, false, false])
    expect(sixth.ended).toBe(false)
  })

  it('a full server answers 503 with Retry-After, and takes streams again when one closes', async () => {
    // The first test left five streams of one person open; one more fills the server (6).
    const filler = await open(await person('filler'))
    expect(filler.status).toBe(200)

    const refused = await open(await person('late'))
    expect(refused.status).toBe(503)
    expect(refused.headers.get('retry-after')).toBe('10')
    expect(refused.refusal).toContain('Too many live streams')

    filler.close()
    const late = await person('later')
    await expect
      .poll(async () => (await open(late)).status, { timeout: 10_000, interval: 250 })
      .toBe(200)
  })
})
