import { Banner, SectionHeader, Switch, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'

import { workspaceAuthQuery, useSaveWorkspaceAuth } from '#features/members/api.ts'

import { Box, BoxRow } from './Box.tsx'

import styles from './Settings.module.css'

/** Which login methods this workspace accepts; the server keeps at least one usable by an owner. */
export function SignInMethods({ workspace }: SignInMethods.Props) {
  const { data } = useQuery(workspaceAuthQuery(workspace))
  const save = useSaveWorkspaceAuth(workspace)
  if (!data) return null
  const { settings, instance } = data
  const locked = !data.canManage || save.isPending
  return (
    <section className={styles.section}>
      <SectionHeader
        title="Sign-in methods"
        description="People sign in with any method the instance offers, but this workspace only shows its teams to sessions that used a method you accept here. Switches apply instantly."
      />
      <Box>
        <BoxRow>
          <Switch
            label="Password"
            description="Email and password."
            checked={settings.passwordLoginEnabled && instance.password}
            disabled={!instance.password || locked}
            onCheckedChange={(on) => save.mutate({ passwordLoginEnabled: on })}
          />
        </BoxRow>
        <BoxRow>
          <Switch
            label="Email code"
            description={
              instance.email
                ? 'A 6-digit code and link mailed to the address.'
                : 'Not set up on this instance'
            }
            checked={settings.emailLoginEnabled && instance.email}
            disabled={!instance.email || locked}
            onCheckedChange={(on) => save.mutate({ emailLoginEnabled: on })}
          />
        </BoxRow>
        {instance.github ? (
          <BoxRow>
            <Switch
              label="GitHub"
              description="Sign-in with a GitHub account. Also covers joining by invitation or verified domain."
              checked={settings.signinGithub}
              disabled={locked}
              onCheckedChange={(on) => save.mutate({ signinGithub: on })}
            />
          </BoxRow>
        ) : null}
        {instance.google ? (
          <BoxRow>
            <Switch
              label="Google"
              description="Sign-in with a Google account. Also covers joining by invitation or verified domain."
              checked={settings.signinGoogle}
              disabled={locked}
              onCheckedChange={(on) => save.mutate({ signinGoogle: on })}
            />
          </BoxRow>
        ) : null}
      </Box>
      <Banner>
        You can’t turn off the last method an owner can sign in with. If everyone is ever locked
        out, an admin can switch one back on from the server with{' '}
        <Text as="code" variant="mono">
          circi admin auth enable password --org {workspace}
        </Text>
        .
      </Banner>
      {save.error ? <Banner tone="danger">{save.error.message}</Banner> : null}
    </section>
  )
}

export namespace SignInMethods {
  export interface Props {
    workspace: string
  }
}
