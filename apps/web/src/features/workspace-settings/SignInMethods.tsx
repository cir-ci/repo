import type { Workspace } from '@circi/api'
import {
  Banner,
  Button,
  Checkbox,
  SettingsRow,
  SettingsSection,
  Text,
  useAnnounce,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { workspaceAuthQuery, useSaveWorkspaceAuth } from '#features/members/api.ts'

import { methodsPatch, type MethodsDraft } from './model.ts'
import { WorkspaceSso } from './WorkspaceSso.tsx'

import styles from './Settings.module.css'

/**
 * Which login methods this workspace accepts; the server keeps at least one usable by an owner.
 * Turning a method off can lock people out, so the changes wait for Save (with Discard).
 */
export function SignInMethods({ workspace }: SignInMethods.Props) {
  const { data } = useQuery(workspaceAuthQuery(workspace))
  if (!data) return null
  // Keyed by what is saved, so a save (or a change elsewhere) resets the draft.
  return <Methods key={JSON.stringify(data.settings)} workspace={workspace} data={data} />
}

function Methods({ workspace, data }: Methods.Props) {
  const save = useSaveWorkspaceAuth(workspace)
  const announce = useAnnounce()
  const { settings, instance } = data
  const saved: MethodsDraft = {
    password: settings.passwordLoginEnabled && instance.password,
    email: settings.emailLoginEnabled && instance.email,
    github: settings.signinGithub,
    google: settings.signinGoogle,
  }
  const [draft, setDraft] = useState(saved)
  const patch = methodsPatch(saved, draft)
  const dirty = Object.keys(patch).length > 0
  const locked = !data.canManage || save.isPending
  const change = (key: keyof MethodsDraft) => (on: boolean) => {
    setDraft({ ...draft, [key]: on })
    if (save.isError) save.reset()
  }

  return (
    <>
      <SettingsSection
        title="Sign-in methods"
        description="People sign in with any method the instance offers, but this workspace only shows its teams to sessions that used a method you accept here. Changes apply when you press Save changes."
      >
        <SettingsRow>
          <Checkbox
            label="Password"
            description="Email and password."
            checked={draft.password}
            disabled={!instance.password || locked}
            onCheckedChange={change('password')}
          />
        </SettingsRow>
        <SettingsRow>
          <Checkbox
            label="Email code"
            description={
              instance.email
                ? 'A 6-digit code and link mailed to the address.'
                : 'Not set up on this instance'
            }
            checked={draft.email}
            disabled={!instance.email || locked}
            onCheckedChange={change('email')}
          />
        </SettingsRow>
        {data.canManage ? <WorkspaceSso workspace={workspace} /> : null}
        {instance.github ? (
          <SettingsRow>
            <Checkbox
              label="GitHub"
              description="Sign-in with a GitHub account. Also covers joining by invitation or verified domain."
              checked={draft.github}
              disabled={locked}
              onCheckedChange={change('github')}
            />
          </SettingsRow>
        ) : null}
        {instance.google ? (
          <SettingsRow>
            <Checkbox
              label="Google"
              description="Sign-in with a Google account. Also covers joining by invitation or verified domain."
              checked={draft.google}
              disabled={locked}
              onCheckedChange={change('google')}
            />
          </SettingsRow>
        ) : null}
      </SettingsSection>
      <Banner>
        You can’t turn off the last method an owner can sign in with. If everyone is ever locked
        out, an admin can switch one back on from the server with{' '}
        <Text as="code" variant="mono">
          circi admin auth enable password --org {workspace}
        </Text>
        .
      </Banner>
      {save.error ? <Banner tone="danger">{save.error.message}</Banner> : null}
      {data.canManage ? (
        <div className={styles.footer}>
          <Button
            variant="ghost"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setDraft(saved)
              save.reset()
            }}
          >
            Discard
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!dirty}
            onClick={() =>
              save.mutate(patch, { onSuccess: () => announce('Sign-in methods saved') })
            }
          >
            Save changes
          </Button>
        </div>
      ) : null}
    </>
  )
}

export namespace SignInMethods {
  export interface Props {
    workspace: string
  }
}

namespace Methods {
  export interface Props {
    workspace: string
    data: Workspace.Auth
  }
}
