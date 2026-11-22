import { describe, expect, it } from 'vitest'

import { parseCirciParameters } from '#src/params.ts'
import { parseViewport, storyViewport, viewportLabel } from '#src/viewports.ts'

describe('parseCirciParameters', () => {
  it('accepts none', () => {
    expect(parseCirciParameters(undefined)).toEqual({})
  })

  it('reads every parameter', () => {
    expect(
      parseCirciParameters({
        skip: false,
        selector: '#x',
        delay: 200,
        padding: 4,
        viewports: ['390x844', { name: 'wide', width: 1600, height: 900 }],
      }),
    ).toEqual({
      skip: false,
      selector: '#x',
      delay: 200,
      padding: 4,
      viewports: [
        { width: 390, height: 844 },
        { name: 'wide', width: 1600, height: 900 },
      ],
    })
  })

  it('says which parameter is wrong', () => {
    expect(() => parseCirciParameters('x')).toThrow('parameters.circi must be an object')
    expect(() => parseCirciParameters({ skip: 'yes' })).toThrow(/skip must be true or false/)
    expect(() => parseCirciParameters({ delay: -1 })).toThrow(/delay must be a number/)
    expect(() => parseCirciParameters({ selector: '' })).toThrow(/selector must be a CSS selector/)
    expect(() => parseCirciParameters({ viewports: [] })).toThrow(/viewports must be a list/)
    expect(() => parseCirciParameters({ viewports: ['big'] })).toThrow(/must look like 1280x720/)
    expect(() => parseCirciParameters({ skp: true })).toThrow('unknown "skp"')
  })
})

describe('viewports', () => {
  it('read 1280x720, a named one and an object, and label them', () => {
    expect(parseViewport('1280x720')).toEqual({ width: 1280, height: 720 })
    expect(parseViewport('mobile=390x844')).toEqual({ name: 'mobile', width: 390, height: 844 })
    expect(viewportLabel(parseViewport('mobile=390x844'))).toBe('mobile')
    expect(viewportLabel(parseViewport({ width: 800, height: 600 }))).toBe('800x600')
    expect(() => parseViewport('0x10')).toThrow(/at least 1/)
    expect(() => parseViewport({ width: 1.5, height: 3 })).toThrow(/width and height in pixels/)
  })
})

describe('storyViewport', () => {
  const options = { phone: { name: 'Phone', styles: { width: '360px', height: '640px' } } }

  it("reads Storybook 9 and 10's globals.viewport, looked up in the story's options", () => {
    expect(
      storyViewport({
        parameters: { viewport: { options } },
        globals: { viewport: { value: 'phone' } },
      }),
    ).toEqual({ name: 'phone', width: 360, height: 640 })
  })

  it("reads Storybook 8's defaultViewport and a viewport given as a plain name", () => {
    expect(
      storyViewport({ parameters: { viewport: { viewports: options, defaultViewport: 'phone' } } }),
    ).toEqual({ name: 'phone', width: 360, height: 640 })
    expect(
      storyViewport({ globals: { viewport: 'phone' }, parameters: { viewport: { options } } }),
    ).toEqual({
      name: 'phone',
      width: 360,
      height: 640,
    })
  })

  it("knows the addon's built-in sizes", () => {
    expect(storyViewport({ globals: { viewport: { value: 'tablet' } } })).toEqual({
      name: 'tablet',
      width: 834,
      height: 1112,
    })
  })

  it('has none when the story chose none, or the toolbar was reset, or the size is unknown', () => {
    expect(
      storyViewport({ parameters: {}, globals: { viewport: { isRotated: false } } }),
    ).toBeUndefined()
    expect(storyViewport({ globals: { viewport: 'reset' } })).toBeUndefined()
    expect(storyViewport({ globals: { viewport: { value: 'unknown' } } })).toBeUndefined()
  })
})
