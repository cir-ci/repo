import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { serveStatic, type StaticServer } from '#src/server.ts'

let root = ''
let server: StaticServer

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'circi-storybook-static-'))
  await mkdir(join(root, 'site/assets'), { recursive: true })
  await writeFile(join(root, 'secret.txt'), 'outside')
  await writeFile(join(root, 'site/index.json'), '{"v":5}')
  await writeFile(join(root, 'site/iframe.html'), '<p>hi</p>')
  await writeFile(join(root, 'site/assets/app.js'), 'export {}')
  server = await serveStatic(join(root, 'site'))
})
afterAll(async () => {
  await server.close()
  await rm(root, { recursive: true, force: true })
})

describe('serveStatic', () => {
  it('serves the files of the folder with their types', async () => {
    const json = await fetch(`${server.url}/index.json`)
    expect(json.status).toBe(200)
    expect(json.headers.get('content-type')).toContain('application/json')
    expect(await json.json()).toEqual({ v: 5 })
    const js = await fetch(`${server.url}/assets/app.js?x=1`)
    expect(js.headers.get('content-type')).toContain('text/javascript')
  })

  it('answers 404 for a missing file and for a folder', async () => {
    expect((await fetch(`${server.url}/nope.html`)).status).toBe(404)
    expect((await fetch(`${server.url}/assets/`)).status).toBe(404)
  })

  it('never serves anything outside the folder', async () => {
    // fetch would tidy `..` away; a raw request keeps it.
    const { request } = await import('node:http')
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(`${server.url}/%2e%2e/secret.txt`, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      req.on('error', reject)
      req.end()
    })
    expect(status).toBe(404)
  })
})
