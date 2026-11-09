import { Button, CheckIcon, CopyIcon, Text } from '@circi/ui'

import { useCopy } from '#lib/use-copy.ts'

import styles from './Admin.module.css'

/** A generated password, shown once: the admin copies it and passes it on. */
export function OnceSecret({ email, password }: OnceSecret.Props) {
  const { copy, state } = useCopy()

  return (
    <div className={styles.once}>
      <span className={styles.onceText}>
        <span>Password for {email}</span>
        <Text variant="mono" data-testid="once-password">
          {password}
        </Text>
        <Text tone="tertiary" variant="small">
          {state === 'failed'
            ? 'Copying failed: select the password and copy it yourself. It won’t be shown again.'
            : 'It won’t be shown again.'}
        </Text>
      </span>
      <Button
        leading={state === 'copied' ? <CheckIcon /> : <CopyIcon />}
        onClick={() => void copy(password)}
        aria-label={`Copy password for ${email}`}
      >
        {state === 'copied' ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

export namespace OnceSecret {
  export interface Props {
    email: string
    password: string
  }
}
