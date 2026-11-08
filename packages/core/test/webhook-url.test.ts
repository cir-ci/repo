import { describe, expect, it } from 'vitest'

import { isPrivateAddress, webhookUrlProblem } from '../src/index.ts'

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd12::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '[::1]',
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe',
    '[::ffff:a00:1]',
    '64:ff9b::7f00:1',
  ])('%s is private', (address) => expect(isPrivateAddress(address)).toBe(true))

  it.each([
    '8.8.8.8',
    '172.32.0.1',
    '100.128.0.1',
    '2606:4700::1111',
    '::ffff:8.8.8.8',
    '::ffff:808:808',
  ])('%s is public', (address) => expect(isPrivateAddress(address)).toBe(false))
})

describe('webhookUrlProblem', () => {
  it('refuses IPv4-mapped IPv6 literals however the URL parser spells them', () => {
    for (const url of ['http://[::ffff:127.0.0.1]/h', 'http://[::ffff:169.254.169.254]/h'])
      expect(webhookUrlProblem(url)).toMatch(/private network/)
    expect(webhookUrlProblem('http://[::ffff:8.8.8.8]/h')).toBeUndefined()
  })

  it('accepts public http(s) addresses', () => {
    expect(webhookUrlProblem('https://hooks.acme.io/circi')).toBeUndefined()
    expect(webhookUrlProblem('http://93.184.216.34/x')).toBeUndefined()
  })

  it.each([
    'not a url',
    'ftp://hooks.acme.io',
    'https://user:pw@hooks.acme.io',
    'http://localhost:8080/x',
    'http://app.localhost/x',
    'http://db/x',
    'http://printer.local/x',
    'http://metadata.internal/x',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/x',
    'http://10.0.0.5/x',
  ])('rejects %s', (url) => expect(webhookUrlProblem(url)).toBeTypeOf('string'))

  it('allows private addresses when the instance opts in', () => {
    expect(webhookUrlProblem('http://10.0.0.5/x', { allowPrivate: true })).toBeUndefined()
    expect(webhookUrlProblem('ftp://x', { allowPrivate: true })).toBeTypeOf('string')
  })
})
