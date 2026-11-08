import { describe, expect, it } from 'vitest'

import { FigmaApiError, FigmaClient, figmaAuthHeaders, isConnectionRevoked } from '#src/index.ts'

import { fakeFigmaHost } from './support/fake-figma-host.ts'

const host = () =>
  fakeFigmaHost({
    tokens: {
      figd_good: { id: 'u1', handle: 'Michael', email: 'm@acme.test' },
      oauth: { id: 'u2', handle: 'Oauth' },
    },
    files: [
      {
        key: 'FileKey12345',
        name: 'Web app — Checkout v3',
        pages: [
          {
            id: '1:1',
            name: 'Checkout',
            children: [
              { id: '2:1', name: 'Cart' },
              { id: '2:2', name: 'Payment' },
              { id: '2:3', name: 'a note', type: 'TEXT' },
            ],
          },
          { id: '1:2', name: 'Empty', children: [] },
        ],
      },
    ],
  })

describe('FigmaClient against a fake Figma', () => {
  it('says who the token belongs to, with either kind of token', async () => {
    const h = host()
    const client = new FigmaClient({ fetch: h.fetch })
    expect(await client.me('figd_good')).toEqual({
      id: 'u1',
      handle: 'Michael',
      email: 'm@acme.test',
    })
    expect((await client.me('oauth')).id).toBe('u2')
    expect(h.requests.map((r) => r.token)).toEqual(['figd_good', 'oauth'])
    expect(figmaAuthHeaders('figd_x')).toEqual({ 'X-Figma-Token': 'figd_x' })
    expect(figmaAuthHeaders('abc')).toEqual({ Authorization: 'Bearer abc' })
  })

  it('treats a rejected token as revoked', async () => {
    const client = new FigmaClient({ fetch: host().fetch })
    const err = await client.me('nope').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FigmaApiError)
    expect(isConnectionRevoked(err)).toBe(true)
  })

  it('reads a file name and pages, then the frames on them', async () => {
    const client = new FigmaClient({ fetch: host().fetch })
    expect(await client.getFile('figd_good', 'FileKey12345')).toEqual({
      name: 'Web app — Checkout v3',
      pages: [
        { id: '1:1', name: 'Checkout' },
        { id: '1:2', name: 'Empty' },
      ],
    })
    expect(await client.listFrames('figd_good', 'FileKey12345')).toEqual([
      { id: '2:1', name: 'Cart', page: 'Checkout' },
      { id: '2:2', name: 'Payment', page: 'Checkout' },
    ])
  })

  it('names nodes and leaves missing ones out', async () => {
    const client = new FigmaClient({ fetch: host().fetch })
    expect(await client.getNodeNames('figd_good', 'FileKey12345', ['2:1', '9:9'])).toEqual({
      '2:1': 'Cart',
    })
    expect(await client.getNodeNames('figd_good', 'FileKey12345', [])).toEqual({})
  })

  it('a file the token cannot see is a plain 404, not a revoked token', async () => {
    const client = new FigmaClient({ fetch: host().fetch })
    const err = await client.getFile('figd_good', 'Missing12345').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FigmaApiError)
    expect(err).toMatchObject({ status: 404, revoked: false })
  })

  it('renders frames and posts comments (for the later steps)', async () => {
    const h = host()
    const client = new FigmaClient({ fetch: h.fetch })
    const images = await client.renderFrames('figd_good', 'FileKey12345', ['2:1', '9:9'], {
      scale: 2,
    })
    expect(images['2:1']).toMatch(/2:1\.png$/)
    expect(images['9:9']).toBeNull()
    expect(h.requests.at(-1)?.path).toContain('format=png&scale=2')
    const id = await client.postComment('figd_good', 'FileKey12345', {
      message: 'Approved',
      nodeId: '2:1',
    })
    expect(h.comments).toEqual([
      { id, fileKey: 'FileKey12345', message: 'Approved', nodeId: '2:1' },
    ])
  })

  it('reports an unreachable Figma as an error with status 0', async () => {
    const client = new FigmaClient({
      fetch: () => Promise.reject(new Error('offline')),
    })
    await expect(client.me('figd_good')).rejects.toMatchObject({ status: 0, revoked: false })
  })
})
