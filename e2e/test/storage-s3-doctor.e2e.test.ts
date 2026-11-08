import { describe, expect, it } from 'vitest'

import { startFakeS3 } from '#src/storage.ts'
import { useStack } from '#src/vitest.ts'

/**
 * What `circi admin doctor` and the server say about a broken S3 configuration (split out of
 * storage-s3.e2e.test.ts so the two run side by side). Nothing here changes the stack: the checks
 * run in extra processes of the container with their own environment, so it shares the `s3` profile.
 */
describe('S3 misconfiguration', () => {
  const ctx = useStack({ profile: 's3' })

  const doctor = (env: Record<string, string>) =>
    ctx.stack.exec(
      'circi',
      ['env', ...Object.entries(env).map(([k, v]) => `${k}=${v}`), 'circi', 'admin', 'doctor'],
      {
        allowFail: true,
      },
    )

  it('doctor reports a missing bucket', async () => {
    const out = await doctor({ S3_BUCKET: 'no-such-bucket' })
    expect(out.code).not.toBe(0)
    expect(out.stdout).toMatch(
      /Storage \(s3\) is not usable: S3 bucket "no-such-bucket" does not exist/,
    )
  })

  it('doctor reports refused credentials', async () => {
    const fake = await startFakeS3(403)
    try {
      const out = await doctor({ S3_ENDPOINT: fake.endpoint })
      expect(out.code).not.toBe(0)
      expect(out.stdout).toMatch(/refused access to bucket.*S3_ACCESS_KEY_ID/)
      expect(fake.requests.length).toBeGreaterThan(0)
    } finally {
      await fake.close()
    }
  })

  it('doctor reports an unreachable endpoint', async () => {
    const out = await doctor({ S3_ENDPOINT: 'http://host.docker.internal:1' })
    expect(out.code).not.toBe(0)
    expect(out.stdout).toMatch(/Cannot reach S3.*S3_ENDPOINT/)
  })

  it('doctor is happy with the working configuration', async () => {
    const out = await doctor({})
    expect(out.stdout).toContain('Storage (s3) is reachable and writable.')
  })

  it('a server started on a missing bucket refuses to start and logs why', async () => {
    const out = await ctx.stack.exec('circi', ['env', 'S3_BUCKET=no-such-bucket', 'circi', 'all'], {
      allowFail: true,
      timeoutMs: 60_000,
    })
    expect(out.code).not.toBe(0)
    const log = out.stdout + out.stderr
    expect(log).toContain('failed to start')
    expect(log).toMatch(/bucket .{1,6}no-such-bucket.{1,6} does not exist/)
    expect(log).toContain('S3_BUCKET')
  })
})
