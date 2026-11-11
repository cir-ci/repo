import { Avatar, SettingsRow, SettingsSection, Text, TextField } from '@circi/ui'
import { useMutation, useQuery } from '@tanstack/react-query'

import { capabilitiesQuery } from '#features/teams/api/index.ts'
import { authClient } from '#lib/auth-client.ts'
import { CheckedTextField } from '#lib/CheckedTextField.tsx'
import { IdentityFields } from '#lib/IdentityFields.tsx'
import { toast } from '#lib/toast.ts'

import { emailChangeQuery, emailProblem, useChangeEmail } from './api.ts'

import styles from '#features/workspace-settings/Settings.module.css'

/** Your picture, your display name (saved with its ✓) and your email, in one row. */
export function YouSection({ user }: YouSection.Props) {
  const save = useMutation({
    meta: { what: 'save' },
    mutationFn: async (next: string) => {
      const { error } = await authClient.updateUser({ name: next })
      if (error) throw new Error(error.message ?? "Couldn't save your name")
    },
    onSuccess: () => toast('Name saved'),
  })
  // Changing the address needs mail to confirm the new one; without it an instance admin does it.
  const { data: caps } = useQuery(capabilitiesQuery())
  const { data: change } = useQuery(emailChangeQuery())
  const changeEmail = useChangeEmail()
  const pending = change?.pendingEmail ?? null

  return (
    <div className={styles.form}>
      <SettingsSection title="Display Settings">
        <SettingsRow>
          <IdentityFields
            avatar={
              <Avatar
                type="user"
                id={user.id}
                name={user.name}
                image={user.image ?? null}
                size={40}
                aria-hidden
              />
            }
            buttonLabel="Change picture"
            panelLabel="Picture"
            panel={
              <Text variant="small" tone="tertiary">
                CirCI uses the picture of the account you sign in with, then Gravatar for your
                email, then a generated avatar.
              </Text>
            }
          >
            <CheckedTextField
              label="Display Name"
              name="name"
              autoComplete="name"
              saved={user.name}
              mutation={save}
              validate={(next) => (next ? null : 'Enter your name')}
              onCommit={(next) => save.mutate(next)}
            />
            {caps?.mailConfigured === true ? (
              <CheckedTextField
                // A sent request goes back to the current address: the pending line shows the new one,
                // and the ✓ doesn't stay to send the mail again.
                key={pending ?? 'none'}
                label="Email"
                name="email"
                type="email"
                autoComplete="email"
                saved={user.email}
                mutation={changeEmail}
                description={pending ? `Waiting for confirmation of ${pending}` : undefined}
                validate={emailProblem}
                onCommit={(next) =>
                  changeEmail.mutate(next, {
                    onSuccess: () => toast(`Check ${next} to confirm the change`),
                  })
                }
              />
            ) : (
              <TextField
                className={styles.emailField}
                label="Email"
                name="email"
                stacked
                value={user.email}
                readOnly
                description="Only an instance admin can change your email."
              />
            )}
          </IdentityFields>
        </SettingsRow>
      </SettingsSection>
    </div>
  )
}

export namespace YouSection {
  export interface Props {
    user: { id: string; name: string; email: string; image?: string | null }
  }
}
