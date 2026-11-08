import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { COLOR_SCHEME_ATTRIBUTE, MODE_STORAGE_KEY } from '@circi/ui'
import { describe, expect, it } from 'vitest'

describe('index.html', () => {
  it('picks the scheme with the theme’s storage key and attribute, so the first paint matches', async () => {
    const html = await readFile(resolve(import.meta.dirname, '../index.html'), 'utf8')
    expect(html).toContain(`'${MODE_STORAGE_KEY}'`)
    expect(html).toContain(`'${COLOR_SCHEME_ATTRIBUTE}'`)
  })
})
