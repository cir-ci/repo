import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { IMAGE_SETTINGS, SECRET_SETTINGS, SETTING_GROUPS, SETTING_NAMES } from '#src/settings.ts'

/**
 * The deploys (the image, deploy/terraform, deploy/docker-compose.yml with deploy/.env.example)
 * against the settings' lists in src/settings.ts: a new setting, secret or group fails here until
 * every deploy has it. That each one is wired to the right name is checked by running the tools:
 * `terraform test` (deploy/terraform/tests) and e2e/test/deploy/compose-settings.deploy.test.ts.
 */
const root = join(import.meta.dirname, '../../..')
const deploy = (path: string) => readFileSync(join(root, 'deploy', path), 'utf8')

const settings = new Set<string>(SETTING_NAMES)
const image = new Set<string>(IMAGE_SETTINGS)
/** What the deploys pass: everything but what the image fixes. */
const passed = SETTING_NAMES.filter((name) => !image.has(name))
const sorted = (names: Iterable<string>) => [...names].toSorted()

describe('deploy/Dockerfile', () => {
  it('fixes exactly the image settings', () => {
    const dockerfile = deploy('Dockerfile')
    const runtime = dockerfile.slice(dockerfile.indexOf(' AS runtime'))
    const env = /\nENV ((?:.*\\\n)*.*)/.exec(runtime)?.[1] ?? ''
    const names = [...env.matchAll(/([A-Z0-9_]+)=/g)].map((m) => m[1] ?? '')
    expect(sorted(names.filter((name) => settings.has(name)))).toEqual(sorted(IMAGE_SETTINGS))
  })
})

/** `NAME = expression` lines of a block, by name. */
const entries = (block: string | undefined, what: string) => {
  if (!block) throw new Error(`no ${what} in main.tf`)
  return new Map(
    [...block.matchAll(/^ {4}([A-Z0-9_]+)\s+= (.+)$/gm)].map((m) => [m[1] ?? '', m[2] ?? '']),
  )
}

describe('deploy/terraform', () => {
  const main = deploy('terraform/main.tf')
  const variables = deploy('terraform/variables.tf').split('\nvariable "').slice(1)
  // The container's environment (the settings that are set) and the secrets' map (passed as files).
  const environment = entries(
    /env = concat\(\[for name, value in \{\n([\s\S]*?)\n {4}\} :/.exec(main)?.[1],
    "the circi container's env",
  )
  const secretFiles = entries(/\n {2}secrets = \{\n([\s\S]*?)\n {2}\}/.exec(main)?.[1], 'secrets')

  it('passes every setting, the secrets as files', () => {
    expect(sorted([...environment.keys(), ...secretFiles.keys()])).toEqual(sorted(passed))
    expect(sorted(secretFiles.keys())).toEqual(sorted(SECRET_SETTINGS))
  })

  it('marks exactly the secrets sensitive', () => {
    const sensitive = variables
      .filter((block) => /\n {2}sensitive\s+= true\n/.test(block))
      .map((block) => block.slice(0, block.indexOf('"')))
    // DATABASE_URL is built from postgres_password or database_password; Caddy's keys aren't the server's.
    const ofTheModule = ['postgres_password', 'database_password', 'caddy_aws_credentials']
    const ofTheServer = SECRET_SETTINGS.filter((name) => name !== 'DATABASE_URL')
    expect(sorted(sensitive)).toEqual(
      sorted([...ofTheServer.map((name) => name.toLowerCase()), ...ofTheModule]),
    )
  })

  it('checks the same groups of settings that go together in the plan', () => {
    // Each group lists the values it checks (`local.smtp.user`, `var.smtp_password`): the setting
    // each one is passed as, from the environment and the secrets' map above.
    const settingOf = new Map(
      [...environment, ...secretFiles].map(([name, expression]) => [expression, name]),
    )
    const block = /\n {2}setting_groups = \{\n([\s\S]*?)\n {2}\}/.exec(main)?.[1] ?? ''
    const groups = [...block.matchAll(/= \[(.*)\]$/gm)].map((m) =>
      (m[1] ?? '')
        .split(', ')
        .map((expression) => settingOf.get(expression) ?? `(not passed: ${expression})`)
        .join(' / '),
    )
    expect(sorted(groups)).toEqual(sorted(Object.values(SETTING_GROUPS).map((g) => g.join(' / '))))
  })

  it('tests the wiring of every setting', () => {
    const tests = deploy('terraform/tests/settings.tftest.hcl')
    const untested = passed.filter(
      (name) => !tests.includes(`"${name}=`) && !tests.includes(`"${name}_FILE=`),
    )
    expect(untested).toEqual([])
  })
})

describe('deploy/docker-compose.yml', () => {
  it('passes every setting to the server', () => {
    const compose = deploy('docker-compose.yml')
    const service = compose.slice(compose.indexOf('\n  circi:'), compose.indexOf('\nvolumes:'))
    const listed = new Set([...service.matchAll(/^ {6}([A-Z0-9_]+):/gm)].map((m) => m[1]))
    expect(passed.filter((name) => !listed.has(name))).toEqual([])
  })

  it('deploy/.env.example names every setting', () => {
    const example = deploy('.env.example')
    const named = new Set([...example.matchAll(/^#? ?([A-Z0-9_]+)=/gm)].map((m) => m[1]))
    // Compose builds DATABASE_URL from POSTGRES_PASSWORD.
    expect(passed.filter((name) => !named.has(name) && name !== 'DATABASE_URL')).toEqual([])
  })
})
