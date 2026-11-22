import { IMAGE_SETTINGS, SETTING_NAMES, type SettingName } from '@circi/config'
import { describe, expect, it } from 'vitest'

import { run } from '#stack/docker.ts'
import { REPO_ROOT } from '#stack/paths.ts'

/**
 * deploy/docker-compose.yml hands each setting to the server under its own name: every setting set
 * to a value of its own, `docker compose config` (Compose's own reading of the file, no containers)
 * shows each one reaching the circi service unchanged. packages/config/test/deploy-settings.test.ts
 * checks the file lists them all; this checks the wiring.
 */
describe('deploy/docker-compose.yml', () => {
  it('passes every setting to the server under its own name', async () => {
    const fixedByCompose = new Set<SettingName>(['DATABASE_URL', 'STORAGE_PATH'])
    const image = new Set<SettingName>(IMAGE_SETTINGS)
    const passed = SETTING_NAMES.filter((name) => !image.has(name) && !fixedByCompose.has(name))
    const values = Object.fromEntries(passed.map((name) => [name, `value-of-${name}`]))

    const { stdout } = await run(
      'docker',
      [
        'compose',
        '--env-file',
        '/dev/null',
        '-f',
        'docker-compose.yml',
        'config',
        '--format',
        'json',
      ],
      { cwd: `${REPO_ROOT}/deploy`, env: { ...values, POSTGRES_PASSWORD: 'pg-password' } },
    )
    const config: { services: { circi: { environment: Record<string, string> } } } =
      JSON.parse(stdout)
    const environment = config.services.circi.environment

    expect(Object.fromEntries(passed.map((name) => [name, environment[name]]))).toEqual(values)
    expect(environment['DATABASE_URL']).toBe('postgres://circi:pg-password@postgres:5432/circi')
  })
})
