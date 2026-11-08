import { resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { webDistPath } from '#lifecycle/services.ts'

const saved = process.env.CIRCI_WEB_DIST
afterEach(() => {
  if (saved === undefined) delete process.env.CIRCI_WEB_DIST
  else process.env.CIRCI_WEB_DIST = saved
})

describe('webDistPath', () => {
  it('points at apps/web/dist, wherever this file sits in apps/server', () => {
    delete process.env.CIRCI_WEB_DIST
    // test/lifecycle → apps/server → apps → web/dist
    expect(webDistPath()).toBe(resolve(import.meta.dirname, '../../../web/dist'))
  })

  it('can be overridden with CIRCI_WEB_DIST', () => {
    process.env.CIRCI_WEB_DIST = '/srv/web'
    expect(webDistPath()).toBe('/srv/web')
  })
})
