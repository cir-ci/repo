import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { IMAGE_SETTINGS, SECRET_SETTINGS, SETTING_GROUPS, SETTING_NAMES } from '#src/settings.ts'

/**
 * The deploys (the image, deploy/terraform, deploy/helm/circi, deploy/docker-compose.yml with
 * deploy/.env.example) against the settings' lists in src/settings.ts: a new setting, secret or
 * group fails here until every deploy has it. That each one is wired to the right name is checked
 * by running the tools: `terraform test` (deploy/terraform/tests), `pnpm test:helm` (the chart's
 * schema and renders) and e2e/test/deploy/compose-settings.deploy.test.ts.
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

/** The `include "circi.set"` lines of a Helm template's body, as setting name -> expression. */
const sets = (body: string) =>
  new Map(
    [...body.matchAll(/include "circi\.set" \(list \$\w+ "([A-Z0-9_]+)" (.+)\) -}}$/gm)].map(
      (m) => [m[1] ?? '', m[2] ?? ''],
    ),
  )

describe('deploy/helm/circi', () => {
  const helpers = deploy('helm/circi/templates/_helpers.tpl')
  const values = deploy('helm/circi/values.yaml')
  const schema = z
    .object({
      additionalProperties: z.boolean(),
      properties: z.record(
        z.string(),
        z
          .object({
            additionalProperties: z.boolean().optional(),
            properties: z.record(z.string(), z.unknown()).optional(),
          })
          .loose(),
      ),
    })
    .parse(JSON.parse(deploy('helm/circi/values.schema.json')))
  /** The keys the schema allows in a group of values. */
  const schemaGroup = (group: string) => schema.properties[group]?.properties ?? {}
  /** The body of a named template, and the `include "circi.set"` lines in it as name -> expression. */
  const define = (name: string) => {
    const body = helpers.split('\n{{- define "').find((block) => block.startsWith(`${name}" -}}`))
    if (!body) throw new Error(`no ${name} template in _helpers.tpl`)
    return body
  }
  const environment = sets(define('circi.settings'))
  // The branch of circi.secrets that makes the Secret (the other one lists an existing Secret's keys).
  const secretFiles = sets(define('circi.secrets'))

  it('passes every setting, the secrets as files', () => {
    expect(sorted(environment.keys())).toEqual(
      sorted(passed.filter((name) => !SECRET_SETTINGS.some((secret) => secret === name))),
    )
    expect(sorted(secretFiles.keys())).toEqual(sorted(SECRET_SETTINGS))
    // A Secret's keys reach the pods as <NAME>_FILE, never as values in the environment.
    expect(deploy('helm/circi/templates/deployment.yaml')).toContain('- name: {{ $name }}_FILE')
  })

  it('checks the same groups of settings that go together', () => {
    const block = /\$groups := dict\n([\s\S]*?)\n-\}\}/.exec(define('circi.validate'))?.[1] ?? ''
    const groups = Object.fromEntries(
      [...block.matchAll(/^ *"(\w+)" \(list (.+)\)$/gm)].map((m) => [
        m[1],
        [...(m[2] ?? '').matchAll(/"([A-Z0-9_]+)"/g)].map((n) => n[1]),
      ]),
    )
    expect(groups).toEqual(SETTING_GROUPS)
  })

  it('has a default and a place in the schema for every value the templates read', () => {
    const templates = ['_helpers.tpl', 'deployment.yaml', 'caddy.yaml', 'ingress.yaml']
      .map((file) => deploy(`helm/circi/templates/${file}`))
      .join('\n')
    const paths = new Set(
      [...templates.matchAll(/\.Values\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/g)].map((m) =>
        [m[1], m[2]].join('.'),
      ),
    )
    // caddy_aws_credentials is null unless given, an object the schema closes (access_key_id, secret_access_key).
    const missing = [...paths].filter((path) => {
      const [group = '', key = ''] = path.split('.')
      if (group === 'caddy_aws_credentials') return false
      const section = new RegExp(`^${group}:.*\\n((?:[ #].*\\n|\\n)*)`, 'm').exec(values)?.[1] ?? ''
      return !new RegExp(`^ {2}${key}:`, 'm').test(section)
    })
    expect(missing).toEqual([])
  })

  it('closes every group of values in the schema', () => {
    expect(schema.additionalProperties).toBe(false)
    const open = Object.entries(schema.properties).filter(
      ([, group]) => group.additionalProperties === undefined && 'properties' in group,
    )
    expect(open.map(([name]) => name)).toEqual([])
  })

  it('has a top-level default for every top-level value the templates read', () => {
    const templates = readdirSync(join(root, 'deploy/helm/circi/templates'))
      .map((file) => deploy(`helm/circi/templates/${file}`))
      .join('\n')
    const read = new Set([...templates.matchAll(/\.Values\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))
    const top = new Set([...values.matchAll(/^([A-Za-z0-9_]+):/gm)].map((m) => m[1]))
    expect([...read].filter((key) => !top.has(key))).toEqual([])
  })

  it("names every CirCI setting like the Terraform module's inputs", () => {
    const variables = deploy('terraform/variables.tf').split('\nvariable "').slice(1)
    const tf = new Map(variables.map((text) => [text.slice(0, text.indexOf('"')), text] as const))
    /** A group's keys in variables.tf: the list its validation allows. */
    const tfKeys = (group: string) => {
      const list = /setsubtract\(keys\(var\.\w+\), \[([^\]]*)\]\)/.exec(tf.get(group) ?? '')?.[1]
      return [...(list ?? '').matchAll(/"(\w+)"/g)].map((m) => m[1] ?? '')
    }
    // The chart's values: the top-level keys, and each map's keys one level down.
    const top: string[] = []
    const chart = new Map<string, string[]>()
    let current: string[] = []
    for (const line of values.split('\n')) {
      const key = /^([A-Za-z0-9_]+):/.exec(line)?.[1]
      if (key) {
        top.push(key)
        current = []
        chart.set(key, current)
      } else {
        const inner = /^ {2}([A-Za-z0-9_]+):/.exec(line)?.[1]
        if (inner) current.push(inner)
      }
    }
    const chartKeys = (group: string) => sorted(chart.get(group) ?? [])

    const scalars = [
      'public_url',
      'previous_public_urls',
      'trusted_proxies',
      'log_level',
      'workspace_creation',
    ]
    const groups = [
      'smtp',
      's3',
      'sign_in',
      'sso',
      'github_app',
      'slack',
      'vapid',
      'sites',
      'jobs',
      'webhooks',
      'tuning',
    ]
    expect(scalars.filter((name) => !tf.has(name))).toEqual([])
    for (const group of groups) {
      expect({ [group]: chartKeys(group) }).toEqual({ [group]: sorted(tfKeys(group)) })
      expect(tfKeys(group)).not.toEqual([])
    }
    // `database` has the module's keys and the chart-only existing_ca_config_map; `caddy` has the
    // module's keys and Kubernetes plumbing.
    expect(sorted(tfKeys('database'))).toEqual([
      'ca_certificate',
      'host',
      'name',
      'port',
      'tls',
      'user',
    ])
    expect(chartKeys('database')).toEqual(sorted([...tfKeys('database'), 'existing_ca_config_map']))
    expect(sorted(tfKeys('caddy'))).toEqual(['aws_region', 'dashboard_host', 'sites_host'])
    expect(chartKeys('caddy')).toEqual(
      sorted([
        ...tfKeys('caddy'),
        'enabled',
        'image',
        'serviceAccount',
        'service',
        'persistence',
        'resources',
        'nodeSelector',
        'tolerations',
        'affinity',
        'podAnnotations',
      ]),
    )

    // Secrets: the module's sensitive variables, but its Postgres password (the module runs its own
    // Postgres) and the Route53 keys (an object, caddy_aws_credentials), are the chart's secret keys.
    const sensitive = [...tf]
      .filter(([, text]) => /sensitive\s+= true/.test(text))
      .map(([name]) => name)
    const secrets = sensitive.filter(
      (name) => name !== 'postgres_password' && name !== 'caddy_aws_credentials',
    )
    const named = [
      'database_password',
      ...SECRET_SETTINGS.filter((name) => name !== 'DATABASE_URL').map((name) =>
        name.toLowerCase(),
      ),
    ]
    expect(sorted(secrets)).toEqual(sorted(named))
    expect(sensitive).toContain('caddy_aws_credentials')
    const expected = [...scalars, ...groups, ...secrets, 'caddy_aws_credentials']
    expect(expected.filter((name) => !top.includes(name))).toEqual([])
    expect(top).not.toContain('secrets')
    // The schema allows the same keys, so a misspelled one is refused.
    for (const group of [...groups, 'database']) {
      expect({ [group]: sorted(Object.keys(schemaGroup(group))) }).toEqual({
        [group]: chartKeys(group),
      })
    }
  })

  it("carries the Caddyfile of deploy/ and the app's version", () => {
    expect(deploy('helm/circi/files/Caddyfile')).toBe(deploy('Caddyfile'))
    const chart = deploy('helm/circi/Chart.yaml')
    const { version } = z
      .object({ version: z.string() })
      .parse(JSON.parse(readFileSync(join(root, 'apps/server/package.json'), 'utf8')))
    expect(/^version: (.+)$/m.exec(chart)?.[1]).toBe(version)
    expect(/^appVersion: (.+)$/m.exec(chart)?.[1]).toBe(version)
  })
})
