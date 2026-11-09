import { Avatar, Banner, Button, SectionHeader, Text, TextField, useAnnounce } from '@circi/ui'
import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { Box } from '#features/workspace-settings/Box.tsx'
import { authClient } from '#lib/auth-client.ts'

import { nameDirty } from './model.ts'

import styles from '#features/workspace-settings/Settings.module.css'

/** Your name and email, and where your picture comes from. */
export function YouSection({ user }: YouSection.Props) {
  const announce = useAnnounce()
  const [name, setName] = useState(user.name)
  const save = useMutation({
    mutationFn: async (next: string) => {
      const { error } = await authClient.updateUser({ name: next })
      if (error) throw new Error(error.message ?? 'Couldn’t save your name')
    },
    onSuccess: () => announce('Name saved'),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (nameDirty(user.name, name)) save.mutate(name.trim())
  }

  return (
    <form className={styles.section} onSubmit={submit} noValidate aria-labelledby="you">
      <SectionHeader
        title={<span id="you">You</span>}
        description="How you appear on builds, reviews and comments in every workspace you belong to."
      />
      <Box>
        <div className={styles.avatarRow}>
          <Avatar name={user.name} size={56} {...(user.image ? { src: user.image } : {})} />
          <Text variant="small" tone="tertiary" className={styles.rowText}>
            CirCI uses the picture of the account you sign in with, then Gravatar for your email,
            then your initials.
          </Text>
        </div>
        <div className={styles.fieldRow}>
          <TextField
            label="Name"
            name="name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            label="Email"
            name="email"
            value={user.email}
            readOnly
            description="Changing your email isn’t available yet: ask an admin."
          />
        </div>
      </Box>
      {save.error ? <Banner tone="danger">{save.error.message}</Banner> : null}
      <div className={styles.footer}>
        <Button
          type="submit"
          variant="primary"
          loading={save.isPending}
          disabled={!nameDirty(user.name, name)}
        >
          Save name
        </Button>
      </div>
    </form>
  )
}

export namespace YouSection {
  export interface Props {
    user: { name: string; email: string; image?: string | null }
  }
}
