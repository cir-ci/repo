import type { Workspace } from '@circi/api'
import { Banner, Button, Checkbox, SettingsRow, SettingsSection, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'

import { workspaceAuthQuery, useSaveWorkspaceAuth } from '#features/members/api.ts'
import { HttpError } from '#lib/http.ts'
import { toast } from '#lib/toast.ts'

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

  // The server refuses a change that would turn off the method this session signed in with, and
  // says which by the request field. The client can't know the method beforehand (a session's
  // method is not exposed), so the refusal is shown on that checkbox.
  const served = save.error instanceof HttpError ? save.error.fields : {}
  const fieldFor = (field: keyof Workspace.Auth['settings']) => served[field]
  const hasFieldError = Object.keys(patch).some((field) => served[field])
  const described = (field: keyof Workspace.Auth['settings'], text: ReactNode) => {
    const problem = fieldFor(field)
    return problem ? (
      <Text tone="failed" role="alert">
        {problem}
      </Text>
    ) : (
      text
    )
  }

  return (
    <>
      <SettingsSection
        title="Sign-in methods"
        description="People sign in with any method the instance offers, but this workspace only shows its teams to sessions that used a method you accept here."
      >
        <SettingsRow>
          <Checkbox
            label="Password"
            description={described('passwordLoginEnabled', 'Email and password.')}
            aria-invalid={fieldFor('passwordLoginEnabled') ? true : undefined}
            checked={draft.password}
            disabled={!instance.password || locked}
            onCheckedChange={change('password')}
          />
        </SettingsRow>
        <SettingsRow>
          <Checkbox
            label="Email code"
            description={described(
              'emailLoginEnabled',
              instance.email
                ? 'A 6-digit code and link mailed to the address.'
                : 'Not set up on this instance',
            )}
            aria-invalid={fieldFor('emailLoginEnabled') ? true : undefined}
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
              description={described(
                'signinGithub',
                'Sign-in with a GitHub account. Also covers joining by invitation or verified domain.',
              )}
              aria-invalid={fieldFor('signinGithub') ? true : undefined}
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
              description={described(
                'signinGoogle',
                'Sign-in with a Google account. Also covers joining by invitation or verified domain.',
              )}
              aria-invalid={fieldFor('signinGoogle') ? true : undefined}
              checked={draft.google}
              disabled={locked}
              onCheckedChange={change('google')}
            />
          </SettingsRow>
        ) : null}
      </SettingsSection>
      <Banner>
        You can't turn off the last method an owner can sign in with. If everyone is ever locked
        out, an admin can switch one back on from the server with{' '}
        <Text as="code" variant="mono">
          circi admin auth enable password --org {workspace}
        </Text>
        .
      </Banner>
      {save.error && !hasFieldError ? <Banner tone="danger">{save.error.message}</Banner> : null}
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
            onClick={() => save.mutate(patch, { onSuccess: () => toast('Sign-in methods saved') })}
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
