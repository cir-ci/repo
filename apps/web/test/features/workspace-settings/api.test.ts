import { describe, expect, it } from 'vitest'

import {
  dayCount,
  fileCount,
  formatBytes,
  kindRows,
  projectRows,
} from '#features/workspace-settings/api.ts'

const project = (slug: string, bytes: number) => ({
  slug,
  name: slug.toUpperCase(),
  color: 'slate' as const,
  icon: null,
  retentionDays: 90,
  files: 1,
  bytes,
})

describe('storage', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(999)).toBe('999 B')
    expect(formatBytes(1500)).toBe('1.5 KB')
    expect(formatBytes(2_000_000)).toBe('2 MB')
    expect(formatBytes(230_000_000)).toBe('230 MB')
  })

  it('lists every kind in order, with its share of the total', () => {
    const rows = kindRows({
      totalBytes: 400,
      kinds: [
        { kind: 'diff', files: 2, bytes: 100 },
        { kind: 'screenshot', files: 5, bytes: 300 },
        { kind: 'site', files: 9, bytes: 50, versions: 3 },
      ],
    })
    expect(rows.map((r) => [r.kind, r.bytes, r.share])).toEqual([
      ['screenshot', 300, 0.75],
      ['diff', 100, 0.25],
      ['thumbnail', 0, 0],
      ['site', 50, 0.125],
    ])
    expect(rows[3]?.versions).toBe(3)
  })

  it('has no share when nothing is stored', () => {
    expect(kindRows({ totalBytes: 0, kinds: [] }).every((r) => r.share === 0)).toBe(true)
  })

  it('sorts projects by size, the biggest with a full bar', () => {
    const rows = projectRows({ projects: [project('a', 100), project('b', 400), project('c', 0)] })
    expect(rows.map((r) => [r.slug, r.share])).toEqual([
      ['b', 1],
      ['a', 0.25],
      ['c', 0],
    ])
    expect(projectRows({ projects: [project('a', 0)] })[0]?.share).toBe(0)
  })

  it('counts files and days', () => {
    expect(fileCount(1)).toBe('1 file')
    expect(fileCount(41260)).toBe('41,260 files')
    expect(dayCount(1)).toBe('1 day')
    expect(dayCount(90)).toBe('90 days')
  })
})
