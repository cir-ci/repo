import { Banner, Checkbox, SectionHeader } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'

import { workspaceAuthQuery, useSaveWorkspaceAuth } from './api.ts'

import styles from './SignInMethods.module.css'

/** Which login methods this workspace accepts; the server keeps at least one usable by an owner. */
export function SignInMethods({ workspace }: SignInMethods.Props) {
  const { data } = useQuery(workspaceAuthQuery(workspace))
  const save = useSaveWorkspaceAuth(workspace)
  if (!data) return null
  const { settings, instance } = data
  const toggle = (patch: Partial<typeof settings>) => save.mutate(patch)
  return (
    <section className={styles.root}>
      <SectionHeader
        title="Sign-in methods"
        description="People sign in with any method the instance offers, but this workspace only shows its teams to sessions that used a method you accept here."
      />
      <div className={styles.methods}>
        <Checkbox
          label="Password"
          checked={settings.passwordLoginEnabled && instance.password}
          disabled={!instance.password || save.isPending}
          onCheckedChange={(on) => toggle({ passwordLoginEnabled: on })}
        />
        <Checkbox
          label="Email code"
          description={instance.email ? undefined : 'Not set up on this instance'}
          checked={settings.emailLoginEnabled && instance.email}
          disabled={!instance.email || save.isPending}
          onCheckedChange={(on) => toggle({ emailLoginEnabled: on })}
        />
      </div>
      {save.error ? <Banner tone="danger">{save.error.message}</Banner> : null}
    </section>
  )
}

export namespace SignInMethods {
  export interface Props {
    workspace: string
  }
}
