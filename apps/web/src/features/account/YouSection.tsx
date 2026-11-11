import { Avatar, SettingsRow, SettingsSection, Text, TextField } from '@circi/ui'
import { useMutation } from '@tanstack/react-query'

import { authClient } from '#lib/auth-client.ts'
import { CheckedTextField } from '#lib/CheckedTextField.tsx'
import { IdentityFields } from '#lib/IdentityFields.tsx'
import { toast } from '#lib/toast.ts'

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
            <TextField
              className={styles.emailField}
              label="Email"
              name="email"
              stacked
              value={user.email}
              readOnly
              description="Changing your email isn't available yet: ask an admin."
            />
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
