import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const web = resolve(import.meta.dirname, '..')
const read = (path: string) => readFile(resolve(web, path), 'utf8')

describe('the installable app', () => {
  it('has a manifest that names it, starts at the dashboard and points at icons that exist', async () => {
    const manifest = JSON.parse(await read('public/manifest.webmanifest'))
    expect(manifest).toMatchObject({
      name: 'CirCI',
      short_name: 'CirCI',
      start_url: '/?source=pwa',
      scope: '/',
      display: 'standalone',
      // The installed app draws its own title bar beside the window's controls.
      display_override: ['window-controls-overlay', 'standalone'],
      theme_color: '#0c0a09',
      background_color: '#0c0a09',
    })
    const purposes = manifest.icons.map((i: { sizes: string; purpose: string }) => [
      i.sizes,
      i.purpose,
    ])
    expect(purposes).toEqual([
      ['192x192', 'any'],
      ['512x512', 'any'],
      ['512x512', 'maskable'],
    ])
    for (const icon of manifest.icons) {
      expect(existsSync(resolve(web, 'public', icon.src.slice(1)))).toBe(true)
    }
    expect(existsSync(resolve(web, 'public/icons/180.png'))).toBe(true)
  })

  it('links the manifest and icon from the page and sets the title-bar colour per scheme', async () => {
    const html = await read('index.html')
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />')
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/180.png" />')
    expect(html).toMatch(/content="#0c0a09" media="\(prefers-color-scheme: dark\)"/)
    expect(html).toMatch(/content="#e9e2de" media="\(prefers-color-scheme: light\)"/)
  })
})
