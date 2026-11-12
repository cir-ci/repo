import { describe, expect, it } from 'vitest'

import { abandonedProjects, processAlive, runIdOf } from '#stack/runs.ts'

describe('abandoned e2e stacks', () => {
  it('reads the run ID from a stack name, and nothing from another project', () => {
    expect(runIdOf('circi-e2e-309aec-8-86cc')).toBe('309aec')
    expect(runIdOf('circi-dev')).toBeUndefined()
    expect(runIdOf('circi-e2e-')).toBeUndefined()
  })

  it("removes the stacks of runs that are gone or never registered, never a live or kept run's", () => {
    const owners = new Map<string, abandonedProjects.Owner>([
      ['live01', { pid: 100 }],
      ['dead02', { pid: 200 }],
      ['kept03', 'keep'],
    ])
    const projects = [
      'circi-e2e-live01-1-aaaa',
      'circi-e2e-dead02-1-bbbb',
      'circi-e2e-dead02-2-cccc',
      'circi-e2e-kept03-1-dddd',
      'circi-e2e-gone04-1-eeee',
      'circi-dev',
    ]
    expect(abandonedProjects(projects, owners, (pid) => pid === 100)).toEqual([
      'circi-e2e-dead02-1-bbbb',
      'circi-e2e-dead02-2-cccc',
      'circi-e2e-gone04-1-eeee',
    ])
  })

  it('knows this process is alive and an unused process ID is not', () => {
    expect(processAlive(process.pid)).toBe(true)
    expect(processAlive(2 ** 22 + 12_345)).toBe(false)
  })
})
