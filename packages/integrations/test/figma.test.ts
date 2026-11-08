import { describe, expect, it } from 'vitest'

import {
  IntegrationUnreachableError,
  integrationRegistry,
  InvalidCredentialsError,
  InvalidInputError,
  linksSpec,
  mappingSpec,
} from '#src/index.ts'
import type { IntegrationDefinition } from '#src/index.ts'

const figma = integrationRegistry.get('figma')
const links = figma?.links
const design = figma?.capabilities.design
const target = figma?.mapping?.target
if (!figma || !links || !design || !target?.resolve) {
  throw new Error('figma is registered with links, a file mapping and a design capability')
}
const resolveFile = target.resolve.bind(target)

/** Figma's HTTP edge: one token, one file with a page and two frames, comments kept. */
function fakeFigma(options: { down?: boolean } = {}) {
  const comments: unknown[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    if (options.down) return new Response('boom', { status: 500 })
    if (req.headers.get('x-figma-token') !== 'figd_good') {
      return Response.json({ err: 'Invalid token' }, { status: 403 })
    }
    if (url.pathname === '/v1/me') return Response.json({ id: 'fu-1', handle: 'michael' })
    if (url.pathname.startsWith('/v1/images/')) {
      return Response.json({ images: { '1:2': 'https://img.test/cart.png' } })
    }
    if (url.pathname.endsWith('/comments')) {
      comments.push(await req.json())
      return Response.json({ id: 'c1' })
    }
    if (!url.pathname.startsWith('/v1/files/FileKey12345')) {
      return Response.json({ err: 'Not found' }, { status: 404 })
    }
    if (url.pathname.endsWith('/nodes')) {
      const ids = (url.searchParams.get('ids') ?? '').split(',')
      const nodes = {
        '0:1': {
          document: {
            id: '0:1',
            name: 'Pages',
            children: [
              { id: '1:1', name: 'Home', type: 'FRAME' },
              { id: '1:2', name: 'Cart', type: 'FRAME' },
            ],
          },
        },
        '1:2': { document: { id: '1:2', name: 'Cart', type: 'FRAME', children: [] } },
      }
      return Response.json({
        nodes: Object.fromEntries(ids.map((id) => [id, Reflect.get(nodes, id) ?? null])),
      })
    }
    return Response.json({
      name: 'Checkout v3',
      document: { id: '0:0', name: 'Document', children: [{ id: '0:1', name: 'Pages' }] },
    })
  }
  const ctx: IntegrationDefinition.Context = {
    authSecret: 'a-long-instance-secret-for-tests-0123456789',
    publicOrigin: 'https://ci.acme.io',
    config: {},
    fetch: fetcher,
  }
  return { ctx, comments }
}

const FILE_URL = 'https://www.figma.com/design/FileKey12345/Checkout?node-id=1-2'

describe('figma connect', () => {
  it('verifies the token with /v1/me and keeps it as the credential', async () => {
    expect(await figma.connect?.({ token: 'figd_good' }, fakeFigma().ctx)).toEqual({
      externalId: 'fu-1',
      displayName: 'michael',
      credentials: 'figd_good',
    })
  })

  it('answers 400 for a rejected token and 502 when Figma is down', async () => {
    await expect(figma.connect?.({ token: 'figd_wrong' }, fakeFigma().ctx)).rejects.toThrow(
      new InvalidCredentialsError('Figma rejected the token'),
    )
    await expect(
      figma.connect?.({ token: 'figd_good' }, fakeFigma({ down: true }).ctx),
    ).rejects.toBeInstanceOf(IntegrationUnreachableError)
  })

  it('flags only a token Figma stopped accepting', async () => {
    const err = await figma
      .connect?.({ token: 'figd_wrong' }, fakeFigma().ctx)
      .catch((e: unknown) => e)
    expect(figma.needsAttention(err)).toBeNull() // the 400 it was mapped to
    const raw = await design
      .listFrames('figd_wrong', 'FileKey12345', fakeFigma().ctx)
      .catch((e: unknown) => e)
    expect(figma.needsAttention(raw)).toMatch(/token was rejected/)
    expect(figma.needsAttention(new Error('x'))).toBeNull()
  })
})

describe('figma file mapping', () => {
  it('takes a pasted address or a file key and names the file', async () => {
    const { ctx } = fakeFigma()
    const mapped = figma.mapping?.target
    expect(mapped?.validate?.('nonsense')).toBe('That is not a Figma file address')
    expect(mapped?.validate?.(FILE_URL)).toBeNull()
    expect(mapped?.validate?.('FileKey12345')).toBeNull()
    for (const ref of [FILE_URL, 'FileKey12345']) {
      // oxlint-disable-next-line no-await-in-loop -- two calls
      expect(await resolveFile(ref, { credentials: 'figd_good' }, ctx)).toEqual({
        ref: 'FileKey12345',
        name: 'Checkout v3',
      })
    }
  })

  it('says why a file cannot be used', async () => {
    const { ctx } = fakeFigma()
    await expect(
      resolveFile('https://www.figma.com/design/OtherFile999/X', { credentials: 'figd_good' }, ctx),
    ).rejects.toThrow(new InvalidInputError('Figma could not find that file'))
    // A rejected token is not the person's typing: it is left for needsAttention to flag.
    const err = await resolveFile(FILE_URL, { credentials: 'figd_wrong' }, ctx).catch(
      (e: unknown) => e,
    )
    expect(err).not.toBeInstanceOf(InvalidInputError)
    expect(figma.needsAttention(err)).not.toBeNull()
  })

  it('is described to the dashboard as a typed file address with frame links', () => {
    expect(mappingSpec(figma.mapping)).toMatchObject({
      targetLabel: 'File',
      targetKind: 'text',
      fields: [],
    })
    expect(linksSpec(links)).toMatchObject({
      kind: 'figma-frame',
      subject: 'pattern',
      autoLink: true,
      fields: [{ key: 'pattern' }, { key: 'url' }],
    })
  })
})

describe('figma frame links', () => {
  it('turns a pasted frame address into a link, with the frame’s name from Figma', async () => {
    expect(
      await links.resolve(
        { pattern: 'cart', url: FILE_URL },
        { credentials: 'figd_good', mappingRef: 'FileKey12345' },
        fakeFigma().ctx,
      ),
    ).toEqual({
      ref: 'FileKey12345:1:2',
      url: 'https://www.figma.com/design/FileKey12345?node-id=1-2',
      title: 'Cart',
      payload: { fileKey: 'FileKey12345', nodeId: '1:2' },
    })
  })

  it('still links while Figma is down, without a name', async () => {
    const draft = await links.resolve(
      { pattern: 'cart', url: FILE_URL },
      { credentials: 'figd_good', mappingRef: null },
      fakeFigma({ down: true }).ctx,
    )
    expect(draft.ref).toBe('FileKey12345:1:2')
    expect(draft.title).toBeUndefined()
  })

  it('wants the address of a frame, not a file', async () => {
    await expect(
      links.resolve(
        { pattern: 'cart', url: 'https://www.figma.com/design/FileKey12345/Checkout' },
        { credentials: 'figd_good', mappingRef: null },
        fakeFigma().ctx,
      ),
    ).rejects.toBeInstanceOf(InvalidInputError)
  })

  it('makes the link of a listed frame without calling Figma', () => {
    expect(design.linkFor('FileKey12345', { id: '1:1', name: 'Home', page: 'Pages' })).toEqual({
      ref: 'FileKey12345:1:1',
      url: 'https://www.figma.com/design/FileKey12345?node-id=1-1',
      title: 'Home',
      payload: { fileKey: 'FileKey12345', nodeId: '1:1' },
    })
  })
})

describe('figma design capability', () => {
  it('lists frames, renders them and comments on them', async () => {
    const { ctx, comments } = fakeFigma()
    expect(await design.listFrames('figd_good', 'FileKey12345', ctx)).toEqual([
      { id: '1:1', name: 'Home', page: 'Pages' },
      { id: '1:2', name: 'Cart', page: 'Pages' },
    ])
    expect(await design.render('figd_good', 'FileKey12345', ['1:2'], ctx)).toEqual({
      '1:2': 'https://img.test/cart.png',
    })
    expect(
      await design.comment('figd_good', 'FileKey12345', { message: 'Hi', nodeId: '1:2' }, ctx),
    ).toBe('c1')
    expect(comments).toHaveLength(1)
  })
})
