import { createHash, randomBytes } from 'node:crypto'

import type { Build } from '@circi/api'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createProject } from '#src/admin.ts'
import { Repo } from '#src/git-repo.ts'
import { screenshot } from '#src/images.ts'
import { uploadOrThrow } from '#src/upload.ts'
import { useBrowser, useStack } from '#src/vitest.ts'

/** The same upload against LocalStack: the bytes land in the bucket and the dashboard serves them back. */
describe('S3 storage on LocalStack', () => {
  const ctx = useStack({ profile: 's3', setup: true })
  const browser = useBrowser()
  let repo: Repo

  beforeAll(async () => {
    repo = await Repo.create()
  })
  afterAll(async () => {
    await repo.destroy()
  })

  it('stores uploaded screenshots in the bucket and serves them through the dashboard', async () => {
    const { stack, setup } = ctx
    const s3 = stack.s3
    if (!s3) throw new Error('no bucket')
    const project = await createProject(setup.session, setup.organization.slug, 'Shop')

    // A colour of its own: the bucket and the file index are shared with other files.
    const home = await screenshot({
      background: `#${randomBytes(3).toString('hex')}`,
      dot: { x: 10, y: 10 },
    })
    await repo.writeShots({ home })
    await repo.commit('first')
    const up = await uploadOrThrow({ stack, token: project.token, repo, wait: true })
    expect(up.uploaded).toBe(1)
    // The project's first build waits for review, so `--wait` exits 1 (no linked repository).
    expect(up.exitCode).toBe(1)

    // The original is in the bucket byte for byte (the CLI used a presigned PUT to LocalStack)...
    const objects = await s3.list()
    expect(objects.length).toBeGreaterThanOrEqual(1)
    const hash = createHash('sha256').update(home).digest('hex')
    const key = objects.find((o) => o.key.includes(hash))?.key
    expect(
      key,
      `an object for sha256 ${hash} in ${JSON.stringify(objects.map((o) => o.key))}`,
    ).toBeDefined()
    expect((await s3.get(key ?? '')).equals(home)).toBe(true)

    // ...and the dashboard serves it back, to the API and to a real browser.
    const detail = await setup.session.get<Build.Detail>(
      `/api/projects/${setup.organization.slug}/${project.slug}/builds/${up.build.number}`,
    )
    const head = detail.diffs[0]?.head
    expect(head?.sha256).toBe(hash)
    const served = await fetch(`${stack.url}/api/files/${hash}`, {
      headers: { cookie: setup.session.cookieHeader },
    })
    expect(served.status).toBe(200)
    expect(Buffer.from(await served.arrayBuffer()).equals(home)).toBe(true)

    const page = await browser.as(setup.session)
    await page.goto(
      `${stack.url}/${setup.organization.slug}/${project.slug}/builds/${up.build.number}`,
    )
    const image = page.getByRole('img', { name: 'New in this build' }).first()
    await image.waitFor()
    await expect
      .poll(() =>
        image.evaluate((el) => {
          const img = el as unknown as { complete: boolean; naturalWidth: number }
          return img.complete && img.naturalWidth
        }),
      )
      .toBe(400)
  })
})
