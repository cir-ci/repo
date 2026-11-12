import { afterEach, describe, expect, it, vi } from 'vitest'

import { fileUrl } from '#features/builds/api/index.ts'
import { absorbFileSignatures, clearFileSignatures, signedFileQuery } from '#lib/file-signatures.ts'

const sha = 'a'.repeat(64)
const inAnHour = Math.floor(Date.now() / 1000) + 3600

afterEach(() => {
  clearFileSignatures()
  vi.useRealTimers()
})

describe('file signatures', () => {
  it('takes the signatures out of a reply and signs the links of the hashes it names', () => {
    const body: Record<string, unknown> = {
      build: { sha256: sha },
      fileSignatures: { [sha]: `${inAnHour}.abc` },
    }
    absorbFileSignatures(body)
    expect(body).toEqual({ build: { sha256: sha } })
    expect(fileUrl(sha)).toBe(`/api/files/${sha}?exp=${inAnHour}&sig=abc`)
    expect(fileUrl('b'.repeat(64))).toBe(`/api/files/${'b'.repeat(64)}`)
  })

  it('leaves a link plain once the signature is about to run out', () => {
    absorbFileSignatures({ fileSignatures: { [sha]: `${inAnHour}.abc` } })
    vi.useFakeTimers({ now: (inAnHour - 30) * 1000 })
    expect(signedFileQuery(sha)).toBe('')
  })

  it('ignores replies without signatures and malformed ones', () => {
    absorbFileSignatures([1, 2])
    absorbFileSignatures(null)
    absorbFileSignatures({ fileSignatures: { [sha]: 'nodot', other: 5 } })
    absorbFileSignatures({ fileSignatures: 'x' })
    expect(signedFileQuery(sha)).toBe('')
  })
})
