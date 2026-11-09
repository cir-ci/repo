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
      if (error) throw new Error(error.message ?? 'Couldn’t save your name')
    },
    onSuccess: () => announce('Name saved'),
  })

  return (
    <div className={styles.form}>
      <SettingsSection
        title="You"
        description="How you appear on builds, reviews and comments in every workspace you belong to. Your name is saved as soon as you change it."
      >
        <SettingsRow>
          <div className={styles.avatarRow}>
            <Avatar name={user.name} size={56} {...(user.image ? { src: user.image } : {})} />
            <Text variant="small" tone="tertiary" className={styles.rowText}>
              CirCI uses the picture of the account you sign in with, then Gravatar for your email,
              then your initials.
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
              description="Changing your email isn’t available yet: ask an admin."
            />
          </div>
        </SettingsRow>
      </SettingsSection>
    </div>
  )
}

export namespace YouSection {
  export interface Props {
    user: { name: string; email: string; image?: string | null }
  }
}
