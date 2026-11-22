import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { UsageError } from '@circi/cli'

import type { circi } from './types.ts'
import { parseViewport, record } from './viewports.ts'

/** The addon's package name: how `.storybook/main.ts` lists it. */
export const ADDON = '@circi/storybook'

const MAIN_FILES = ['main.ts', 'main.mts', 'main.js', 'main.mjs', 'main.cjs', 'main.cts']

/** Whether an `addons` entry (a name or path, or `{ name, options }`) is this package. */
export function isAddon(name: unknown): boolean {
  if (typeof name !== 'string') return false
  const path = name.replaceAll('\\', '/')
  return path === ADDON || path.startsWith(`${ADDON}/`) || path.includes(`/node_modules/${ADDON}`)
}

/** The options of this addon in a Storybook main config's `addons`, or none. */
export function addonOptions(main: unknown): circi.Options {
  const addons = record(main)?.addons
  if (!Array.isArray(addons)) return {}
  for (const entry of addons) {
    if (isAddon(entry)) return {}
    const object = record(entry)
    if (object && isAddon(object.name)) {
      if (object.options === undefined) return {}
      const options = record(object.options)
      if (!options)
        throw new UsageError(`The options of ${ADDON} in your Storybook config must be an object`)
      return readOptions(options)
    }
  }
  return {}
}

const STRINGS = ['apiUrl', 'token', 'name', 'dir', 'root', 'staticDir'] as const
const BOOLEANS = ['clean', 'wait', 'strict', 'build'] as const
const NUMBERS = ['concurrency', 'padding', 'delay', 'timeout'] as const

/** Checks what the Storybook config gave for this addon, naming the option that is wrong. */
function bad(key: string, expected: string): UsageError {
  return new UsageError(`Option "${key}" of ${ADDON} must be ${expected}`)
}

export function readOptions(value: Record<string, unknown>): circi.Options {
  const out: circi.Options = {}
  for (const key of STRINGS) {
    const v = value[key]
    if (v === undefined) continue
    if (typeof v !== 'string') throw bad(key, 'a string')
    out[key] = v
  }
  for (const key of BOOLEANS) {
    const v = value[key]
    if (v === undefined) continue
    if (typeof v !== 'boolean') throw bad(key, 'true or false')
    out[key] = v
  }
  for (const key of NUMBERS) {
    const v = value[key]
    if (v === undefined) continue
    if (typeof v !== 'number') throw bad(key, 'a number')
    out[key] = v
  }
  for (const key of ['include', 'exclude'] as const) {
    const v = value[key]
    if (v === undefined) continue
    if (!Array.isArray(v) || !v.every((item): item is string => typeof item === 'string')) {
      throw bad(key, 'a list of globs')
    }
    out[key] = v
  }
  if (value.browsers !== undefined) {
    const v = value.browsers
    if (!Array.isArray(v) || !v.every((b): b is circi.Browser => BROWSERS.has(b))) {
      throw bad('browsers', 'a list of chromium, firefox or webkit')
    }
    out.browsers = v
  }
  if (value.viewports !== undefined) {
    if (!Array.isArray(value.viewports)) throw bad('viewports', 'a list of viewports')
    const list: circi.Viewport[] = []
    for (const viewport of value.viewports) {
      const size = parseViewport(viewport)
      list.push(size.name ? { name: size.name, width: size.width, height: size.height } : size)
    }
    out.viewports = list
  }
  const site = value.site
  if (site !== undefined) {
    const object = record(site)
    if (typeof site === 'boolean') out.site = site
    else if (object) out.site = typeof object.name === 'string' ? { name: object.name } : {}
    else throw bad('site', 'true or { name }')
  }
  const shard = record(value.shard)
  if (value.shard !== undefined) {
    if (typeof shard?.index !== 'number' || typeof shard.total !== 'number') {
      throw bad('shard', '{ index, total }')
    }
    out.shard = {
      index: shard.index,
      total: shard.total,
      ...(typeof shard.nonce === 'string' ? { nonce: shard.nonce } : {}),
    }
  }
  return out
}

/**
 * Reads `.storybook/main.*` and returns this addon's options from it (none when the config doesn't
 * list the addon or doesn't exist: the defaults and flags are enough to run).
 */
export async function loadAddonOptions(
  root: string,
  configDir = '.storybook',
): Promise<circi.Options> {
  const dir = resolve(root, configDir)
  const file = MAIN_FILES.map((name) => join(dir, name)).find((path) => existsSync(path))
  if (!file) return {}
  let module: unknown
  try {
    module = await import(pathToFileURL(file).href)
  } catch (err) {
    const code = err instanceof Error && 'code' in err ? String(err.code) : ''
    if (
      code === 'ERR_UNKNOWN_FILE_EXTENSION' ||
      code === 'ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING'
    ) {
      throw new UsageError(
        `Node can't read ${file}: running TypeScript needs Node 22.18 or newer. Update Node, or write the Storybook config as main.js.`,
      )
    }
    throw new UsageError(
      `Couldn't read the Storybook config ${file}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`,
    )
  }
  const exported = record(module)
  return addonOptions(exported?.default ?? module)
}

export interface Resolved {
  root: string
  staticDir: string
  /** Where PNGs are written, and what is uploaded. */
  outDir: string
  name: string
  browsers: circi.Browser[]
  concurrency: number
  include: string[]
  exclude: string[]
  padding: number
  delay: number
  timeout: number
  site: { name: string } | undefined
}

const BROWSERS = new Set(['chromium', 'firefox', 'webkit'])

function number(value: number | undefined, fallback: number, what: string, min: number): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value < min) throw new UsageError(`${what} must be ${min} or more`)
  return value
}

export function resolveOptions(options: circi.Options, cwd: string): Resolved {
  const root = resolve(cwd, options.root ?? '.')
  const browsers = options.browsers?.length
    ? [...new Set(options.browsers)]
    : (['chromium'] as const)
  for (const browser of browsers) {
    if (!BROWSERS.has(browser)) {
      throw new UsageError(`Unknown browser "${browser}": use chromium, firefox or webkit`)
    }
  }
  const site = options.site
  return {
    root,
    staticDir: resolve(root, options.staticDir ?? 'storybook-static'),
    outDir: join(resolve(root, options.dir ?? '.circi/screenshots'), 'storybook'),
    name: options.name ?? 'storybook',
    browsers: [...browsers],
    concurrency: Math.floor(number(options.concurrency, 4, 'concurrency', 1)),
    include: options.include ?? [],
    exclude: options.exclude ?? [],
    padding: number(options.padding, 0, 'padding', 0),
    delay: number(options.delay, 0, 'delay', 0),
    timeout: number(options.timeout, 30, 'timeout', 1),
    site: site
      ? { name: typeof site === 'object' && site.name ? site.name : 'storybook' }
      : undefined,
  }
}
