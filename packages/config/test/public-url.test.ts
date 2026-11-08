import { describe, expect, it } from 'vitest'

import { isLocalAddress, parsePublicAddress } from '../src/public-url.ts'

describe('parsePublicAddress', () => {
  it('normalises the origin and host', () => {
    expect(parsePublicAddress(' https://CI.Acme.io/ ', 'PUBLIC_URL')).toEqual({
      origin: 'https://ci.acme.io',
      host: 'ci.acme.io',
      protocol: 'https:',
      hostname: 'ci.acme.io',
    })
  })

  it('keeps a non-default port and drops a default one', () => {
    expect(parsePublicAddress('http://localhost:3000', 'X')).toMatchObject({
      host: 'localhost:3000',
    })
    expect(parsePublicAddress('https://ci.acme.io:443', 'X')).toMatchObject({ host: 'ci.acme.io' })
  })

  it.each([
    ['not a url', /is not a URL/],
    ['ftp://ci.acme.io', /must start with https/],
    ['https://user:pw@ci.acme.io', /username or password/],
    ['https://ci.acme.io/?a=1', /query string/],
    ['https://ci.acme.io/#frag', /query string/],
    ['https://ci.acme.io/sub', /without a path/],
  ])('refuses %s with a message naming the setting', (raw, message) => {
    const result = parsePublicAddress(raw, 'PUBLIC_URL')
    expect(typeof result).toBe('string')
    expect(result).toMatch(/^PUBLIC_URL: /)
    expect(result).toMatch(message)
  })
})

describe('isLocalAddress', () => {
  it.each([
    ['http://localhost:3000', true],
    ['http://127.0.0.1:3000', true],
    ['http://[::1]:3000', true],
    ['http://ci.localhost', true],
    ['https://ci.acme.io', false],
  ])('%s -> %s', (raw, expected) => {
    const address = parsePublicAddress(raw, 'X')
    if (typeof address === 'string') throw new Error(address)
    expect(isLocalAddress(address)).toBe(expected)
  })
})
