import type { Team } from '@circi/api'
import { Banner } from '@circi/ui'

/**
 * Shown on the team page and its settings while GitHub refuses the team's installation:
 * check runs and pull request comments have stopped, and only a person can fix it.
 */
export function GitAttentionBanner({ attention }: GitAttentionBanner.Props) {
  if (!attention) return null
  return (
    <Banner tone="danger" title="CirCI can’t reach GitHub for this team">
      The GitHub App was removed or suspended, so build results are not being reported on pull
      requests. Reinstall or unsuspend the App on GitHub, then save the repository again under the
      workspace’s Settings › Integrations › GitHub.
    </Banner>
  )
}

export namespace GitAttentionBanner {
  export interface Props {
    attention: Team.GitAttention | null | undefined
  }
}
