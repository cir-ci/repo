import { describe, expect, it } from 'vitest'

import {
  clearSessionHint,
  HINT_MAX_AGE_MS,
  readFreshSessionHint,
  readSessionHint,
  sessionState,
  sessionSync,
  writeSessionHint,
} from '#lib/session-hint.ts'

const ADA = { id: 'u1', name: 'Ada', email: 'ada@example.test', image: null }
const BOB = { id: 'u2', name: 'Bob', email: 'bob@example.test', image: null }

const verified = (user: typeof ADA) => ({ kind: 'signed-in' as const, user, verified: true })

function memory() {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  }
}

describe('the remembered person', () => {
  it('round-trips and is forgotten', () => {
    const storage = memory()
    expect(readSessionHint(storage)).toBeNull()
    writeSessionHint(ADA, storage)
    expect(readSessionHint(storage)).toEqual(ADA)
    clearSessionHint(storage)
    expect(readSessionHint(storage)).toBeNull()
  })

  it('reads nothing from a broken or incomplete value, and nothing where there is no storage', () => {
    const storage = memory()
    storage.setItem('circi-session-hint', 'nope')
    expect(readSessionHint(storage)).toBeNull()
    storage.setItem('circi-session-hint', JSON.stringify({ id: 'u1' }))
    expect(readSessionHint(storage)).toBeNull()
    expect(readSessionHint(undefined)).toBeNull()
  })
})

describe('sessionState', () => {
  it('draws the app at once for a remembered person while the check is pending, not verified', () => {
    expect(sessionState({ isPending: true, user: null }, ADA)).toEqual({
      kind: 'signed-in',
      user: ADA,
      verified: false,
    })
  })

  it('waits, as before, when nobody is remembered', () => {
    expect(sessionState({ isPending: true, user: null }, null)).toEqual({ kind: 'checking' })
  })

  it('takes the checked session over the remembered one', () => {
    expect(sessionState({ isPending: false, user: BOB }, ADA)).toEqual({
      kind: 'signed-in',
      user: BOB,
      verified: true,
    })
  })

  it('signs out when the check answers with nobody or a 401', () => {
    expect(sessionState({ isPending: false, user: null }, ADA)).toEqual({ kind: 'signed-out' })
    expect(sessionState({ isPending: false, user: null, error: { status: 401 } }, ADA)).toEqual({
      kind: 'signed-out',
    })
  })

  it('keeps the app of a remembered person when the check could not reach the server', () => {
    expect(sessionState({ isPending: false, user: null, error: { status: 0 } }, ADA).kind).toBe(
      'signed-in',
    )
    expect(sessionState({ isPending: false, user: null, error: { status: 503 } }, ADA).kind).toBe(
      'signed-in',
    )
    expect(sessionState({ isPending: false, user: null, error: { status: 503 } }, null).kind).toBe(
      'signed-out',
    )
  })
})

describe('sessionSync', () => {
  it('forgets everything when signed out', () => {
    expect(sessionSync({ kind: 'signed-out' }, ADA)).toBe('forget')
  })

  it('switches when another person signs in, and remembers the same one', () => {
    expect(sessionSync(verified(BOB), ADA)).toBe('switch')
    expect(sessionSync(verified(ADA), ADA)).toBe('remember')
    expect(sessionSync(verified(ADA), null)).toBe('remember')
  })

  it('changes nothing until the session is verified', () => {
    expect(sessionSync({ kind: 'signed-in', user: ADA, verified: false }, ADA)).toBe('none')
    expect(sessionSync({ kind: 'checking' }, null)).toBe('none')
  })
})

describe('render-first only soon after the last check', () => {
  const now = 1_800_000_000_000

  it('uses the remembered person within 12 hours of the last check', () => {
    const storage = memory()
    writeSessionHint(ADA, storage, now)
    expect(readFreshSessionHint(storage, now + HINT_MAX_AGE_MS)).toEqual(ADA)
  })

  it('falls back to the plain checking path when the hint is older, but still knows who was here', () => {
    const storage = memory()
    writeSessionHint(ADA, storage, now)
    const later = now + HINT_MAX_AGE_MS + 1
    const fresh = readFreshSessionHint(storage, later)
    expect(fresh).toBeNull()
    expect(sessionState({ isPending: true, user: null }, fresh)).toEqual({ kind: 'checking' })
    // The data is still dropped for a different person: the raw hint says who it was.
    expect(readSessionHint(storage)).toEqual(ADA)
  })

  it('treats a hint with no time (an older build) or a time in the future as old', () => {
    const storage = memory()
    storage.setItem('circi-session-hint', JSON.stringify(ADA))
    expect(readFreshSessionHint(storage, now)).toBeNull()
    writeSessionHint(ADA, storage, now + 1000)
    expect(readFreshSessionHint(storage, now)).toBeNull()
  })
})
