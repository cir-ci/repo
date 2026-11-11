import type { NavigateOptions } from '@tanstack/react-router'

/** Where a screenshot's baseline is shown inside project settings (Ignore regions); the name is the splat. */
export function ignoreRegionLink(
  workspace: string,
  project: string,
  name: string,
): NavigateOptions {
  return {
    to: '/$workspace/$project/settings/ignore-regions/$',
    params: { workspace, project, _splat: name },
  }
}
