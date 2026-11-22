import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { UsageError } from '@circi/cli'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  addonOptions,
  isAddon,
  loadAddonOptions,
  readOptions,
  resolveOptions,
} from '#src/config.ts'
import { circiStorybook } from '#src/index.ts'

describe('the addon entry', () => {
  it('is what circiStorybook() returns: a Storybook addon with options', () => {
    expect(circiStorybook({ name: 'x' })).toEqual({
      name: '@circi/storybook',
      options: { name: 'x' },
    })
    expect(circiStorybook()).toEqual({ name: '@circi/storybook', options: {} })
  })

  it('is found in `addons` by name, a subpath or a resolved path', () => {
    expect(isAddon('@circi/storybook')).toBe(true)
    expect(isAddon('@circi/storybook/preset')).toBe(true)
    expect(isAddon('/p/node_modules/@circi/storybook/dist/preset.mjs')).toBe(true)
    expect(isAddon('@storybook/addon-docs')).toBe(false)
    expect(isAddon({ name: 'x' })).toBe(false)
  })

  it('gives its options, or none when it is listed as a bare name or not at all', () => {
    expect(
      addonOptions({ addons: ['a', { name: '@circi/storybook', options: { name: 'sb' } }] }),
    ).toEqual({
      name: 'sb',
    })
    expect(addonOptions({ addons: ['@circi/storybook'] })).toEqual({})
    expect(addonOptions({ addons: ['a'] })).toEqual({})
    expect(addonOptions({})).toEqual({})
  })
})

describe('readOptions', () => {
  it('keeps the options the shared and the Storybook-specific sets name', () => {
    const options = {
      apiUrl: 'https://ci.acme.io',
      token: 't',
      name: 'sb',
      dir: 'shots',
      clean: true,
      root: '.',
      wait: true,
      strict: true,
      shard: { index: 1, total: 3, nonce: 'n' },
      staticDir: 'out',
      build: true,
      browsers: ['chromium', 'webkit'],
      viewports: ['1280x720', { name: 'm', width: 390, height: 844 }],
      concurrency: 2,
      include: ['A/**'],
      exclude: ['B/**'],
      site: { name: 'docs' },
      padding: 2,
      delay: 100,
      timeout: 20,
    }
    expect(readOptions(options)).toEqual({
      ...options,
      viewports: [
        { width: 1280, height: 720 },
        { name: 'm', width: 390, height: 844 },
      ],
    })
  })

  it('names the option that has the wrong kind of value', () => {
    expect(() => readOptions({ name: 1 })).toThrow(
      /Option "name" of @circi\/storybook must be a string/,
    )
    expect(() => readOptions({ wait: 'yes' })).toThrow(/"wait".*true or false/)
    expect(() => readOptions({ concurrency: '2' })).toThrow(/"concurrency".*a number/)
    expect(() => readOptions({ include: 'A' })).toThrow(/"include".*list of globs/)
    expect(() => readOptions({ browsers: ['ie'] })).toThrow(/"browsers"/)
    expect(() => readOptions({ shard: 2 })).toThrow(/"shard"/)
    expect(() => readOptions({ viewports: ['wide'] })).toThrow(/must look like 1280x720/)
  })
})

describe('resolveOptions', () => {
  it("fills the defaults: the vitest plugin's folder, one browser, `storybook` as the build name", () => {
    const resolved = resolveOptions({}, '/work/app')
    expect(resolved).toMatchObject({
      root: '/work/app',
      staticDir: '/work/app/storybook-static',
      outDir: '/work/app/.circi/screenshots/storybook',
      name: 'storybook',
      browsers: ['chromium'],
      concurrency: 4,
      include: [],
      exclude: [],
      padding: 0,
      delay: 0,
      timeout: 30,
      site: undefined,
    })
  })

  it('resolves paths from the root and names the site', () => {
    const resolved = resolveOptions(
      { root: 'web', dir: 'shots', staticDir: 'sb', site: true },
      '/work',
    )
    expect(resolved).toMatchObject({
      root: '/work/web',
      staticDir: '/work/web/sb',
      outDir: '/work/web/shots/storybook',
      site: { name: 'storybook' },
    })
    expect(resolveOptions({ site: { name: 'docs' } }, '/w').site).toEqual({ name: 'docs' })
  })

  it('refuses nonsense with a usage error', () => {
    expect(() => resolveOptions({ concurrency: 0 }, '/w')).toThrow(UsageError)
    expect(() => resolveOptions({ padding: -1 }, '/w')).toThrow(/padding must be 0 or more/)
  })
})

describe('loadAddonOptions', () => {
  let root = ''
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'circi-storybook-config-'))
    await mkdir(join(root, '.storybook'))
    await writeFile(
      join(root, '.storybook/main.mjs'),
      "export default { addons: [{ name: '@circi/storybook', options: { name: 'from-main', browsers: ['firefox'] } }] }\n",
    )
    await mkdir(join(root, 'other'))
    await writeFile(join(root, 'other/main.mjs'), 'throw new Error("broken config")\n')
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it("reads the addon's options from .storybook/main", async () => {
    expect(await loadAddonOptions(root)).toEqual({ name: 'from-main', browsers: ['firefox'] })
  })

  it('has no options when there is no Storybook config', async () => {
    expect(await loadAddonOptions(join(root, 'nowhere'))).toEqual({})
  })

  it('says which file could not be read', async () => {
    await expect(loadAddonOptions(root, 'other')).rejects.toThrow(
      /Couldn't read the Storybook config .*main\.mjs: broken config/,
    )
  })
})
