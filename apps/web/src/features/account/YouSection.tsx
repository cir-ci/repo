import { Avatar, SettingsRow, SettingsSection, Text, TextField, useAnnounce } from '@circi/ui'
import { useMutation } from '@tanstack/react-query'

import { authClient } from '#lib/auth-client.ts'
import { IdentityEditor } from '#lib/IdentityEditor.tsx'

import styles from '#features/workspace-settings/Settings.module.css'

/** Your picture and name in one row, and your email. The name saves as soon as you leave the field. */
export function YouSection({ user }: YouSection.Props) {
  const announce = useAnnounce()
  const save = useMutation({
    mutationFn: async (next: string) => {
      const { error } = await authClient.updateUser({ name: next })
      if (error) throw new Error(error.message ?? "Couldn't save your name")
    },
    onSuccess: () => announce('Name saved'),
  })

  return (
    <div className={styles.form}>
      <SettingsSection title="Name and picture">
        <SettingsRow>
          <IdentityEditor
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
            name="name"
            autoComplete="name"
            saved={user.name}
            mutation={save}
            validate={(next) => (next ? null : 'Enter your name')}
            onCommit={(next) => save.mutate(next)}
          />
        </SettingsRow>
        <SettingsRow>
          <TextField
            label="Email"
            name="email"
            value={user.email}
            readOnly
            description="Changing your email isn't available yet: ask an admin."
          />
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
