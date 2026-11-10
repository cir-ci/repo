import { Avatar, SettingsRow, SettingsSection, Text, TextField, useAnnounce } from '@circi/ui'
import { useMutation } from '@tanstack/react-query'

import { authClient } from '#lib/auth-client.ts'
import { InstantTextField } from '#lib/InstantTextField.tsx'

import styles from '#features/workspace-settings/Settings.module.css'

/** Your name and email, and where your picture comes from. The name saves as soon as you leave the field. */
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
      <SettingsSection
        title="You"
        description="How you appear on builds, reviews and comments in every workspace you belong to."
      >
        <SettingsRow>
          <div className={styles.avatarRow}>
            <Avatar
              type="user"
              id={user.id}
              name={user.name}
              image={user.image ?? null}
              size={56}
            />
            <Text variant="small" tone="tertiary" className={styles.rowText}>
              CirCI uses the picture of the account you sign in with, then Gravatar for your email,
              then a generated avatar.
            </Text>
          </div>
        </SettingsRow>
        <SettingsRow>
          <div className={styles.rowFields}>
            <InstantTextField
              label="Name"
              name="name"
              autoComplete="name"
              saved={user.name}
              mutation={save}
              validate={(next) => (next ? null : 'Enter your name')}
              onCommit={(next) => save.mutate(next)}
            />
            <TextField
              label="Email"
              name="email"
              value={user.email}
              readOnly
              description="Changing your email isn't available yet: ask an admin."
            />
          </div>
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
