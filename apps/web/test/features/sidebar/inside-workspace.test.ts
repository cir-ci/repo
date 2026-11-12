import { describe, expect, it } from 'vitest'

import { insideWorkspace } from '#features/sidebar/SettingsNav.tsx'

describe('insideWorkspace', () => {
  it("is true on a project's settings in that workspace, and on its projects list", () => {
    expect(insideWorkspace('/acme/web/settings', 'acme')).toBe(true)
    expect(insideWorkspace('/acme/web/settings/general', 'acme')).toBe(true)
    expect(insideWorkspace('/workspaces/acme/settings/projects', 'acme')).toBe(true)
  })

  it("is false on the workspace's own settings pages (its entry is selected there) and elsewhere", () => {
    expect(insideWorkspace('/workspaces/acme/settings', 'acme')).toBe(false)
    expect(insideWorkspace('/workspaces/acme/settings/members', 'acme')).toBe(false)
    expect(insideWorkspace('/globex/web/settings', 'acme')).toBe(false)
    expect(insideWorkspace('/acme/web', 'acme')).toBe(false)
    expect(insideWorkspace('/account/profile', 'acme')).toBe(false)
  })
})
