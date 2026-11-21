import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { envSchema } from '#src/schema.ts'

/**
 * Every setting the server reads can be given in each way to deploy it: the Terraform module
 * (deploy/terraform, a key of its `settings` or `secrets` map, each from a variable of its own), the
 * Compose file (passed from deploy/.env) and deploy/.env.example (set, or in a comment). A new
 * setting fails here until all three have it.
 */
const deploy = (path: string) =>
  readFileSync(new URL(`../../../deploy/${path}`, import.meta.url), 'utf8')

const settings = Object.keys(envSchema.shape)

/** Fixed by the image (deploy/Dockerfile): the port, the volume and the bundle's paths. */
const setByImage = new Set([
  'NODE_ENV',
  'HOST',
  'PORT',
  'STORAGE_PATH',
  'CIRCI_MIGRATIONS',
  'CIRCI_WEB_DIST',
])

describe('deploy/terraform', () => {
  it('the Terraform module passes every setting', () => {
    const main = deploy('terraform/main.tf')
    const block = (name: string) => {
      const match = new RegExp(`\\n  ${name} = \\{\\n([\\s\\S]*?)\\n  \\}`).exec(main)
      if (!match?.[1]) throw new Error(`no ${name} map in main.tf`)
      return [...match[1].matchAll(/^ {4}([A-Z0-9_]+)\s+=/gm)].map((m) => m[1])
    }
    const passed = [...block('settings'), ...block('secrets')]
    expect(passed.filter((key) => !settings.includes(key ?? ''))).toEqual([])
    expect(settings.filter((key) => !passed.includes(key) && !setByImage.has(key))).toEqual([])
  })

  it('the Terraform module marks every secret sensitive', () => {
    const variables = deploy('terraform/variables.tf').split('\nvariable "').slice(1)
    const secretLike = variables.filter((block) =>
      /^[a-z0-9_]*(secret|password|private_key|credentials|secret_access_key)"/.test(block),
    )
    expect(secretLike.length).toBeGreaterThan(10)
    const notSensitive = secretLike
      .filter((block) => !/\n {2}sensitive\s+= true\n/.test(block))
      .map((block) => block.slice(0, block.indexOf('"')))
    expect(notSensitive).toEqual([])
  })
})

describe('deploy/docker-compose.yml', () => {
  it('passes every setting to the server', () => {
    const compose = deploy('docker-compose.yml')
    const service = compose.slice(compose.indexOf('\n  circi:'), compose.indexOf('\nvolumes:'))
    const passed = new Set([...service.matchAll(/^ {6}([A-Z0-9_]+):/gm)].map((m) => m[1]))
    const missing = settings.filter((key) => !passed.has(key) && !setByImage.has(key))
    expect(missing).toEqual([])
  })

  it('deploy/.env.example names every setting it passes', () => {
    const example = deploy('.env.example')
    const named = new Set([...example.matchAll(/^#? ?([A-Z0-9_]+)=/gm)].map((m) => m[1]))
    // Compose builds DATABASE_URL from POSTGRES_PASSWORD and fixes STORAGE_PATH to its volume.
    const fixed = new Set(['DATABASE_URL', 'STORAGE_PATH'])
    const missing = settings.filter(
      (key) => !named.has(key) && !setByImage.has(key) && !fixed.has(key),
    )
    expect(missing).toEqual([])
  })
})
