import type { NavigateOptions } from '@tanstack/react-router'

/** Where a screenshot's baseline is shown inside team settings (Ignore regions); the name is the splat. */
export function ignoreRegionLink(workspace: string, team: string, name: string): NavigateOptions {
  return {
    to: '/$workspace/$team/settings/ignore-regions/$',
    params: { workspace, team, _splat: name },
  }
}
