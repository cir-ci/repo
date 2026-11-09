import { Button, CheckIcon, CopyIcon, Text } from '@circi/ui'
import { useState } from 'react'

import { clipboard } from './api/admin.ts'

import styles from './Admin.module.css'

/** A generated password, shown once: the admin copies it and passes it on. */
export function OnceSecret({ email, password }: OnceSecret.Props) {
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null)

  function copy() {
    clipboard.write(password).then(
      () => setCopied('yes'),
      () => setCopied('failed'),
    )
  }

  return (
    <div className={styles.once}>
      <span className={styles.onceText}>
        <span>Password for {email}</span>
        <Text variant="mono" data-testid="once-password">
          {password}
        </Text>
        <Text tone="tertiary" variant="small">
          {copied === 'failed'
            ? 'Copying failed: select the password and copy it yourself. It won’t be shown again.'
            : 'It won’t be shown again.'}
        </Text>
      </span>
      <Button
        leading={copied === 'yes' ? <CheckIcon /> : <CopyIcon />}
        onClick={copy}
        aria-label={`Copy password for ${email}`}
      >
        {copied === 'yes' ? 'Copied' : 'Copy'}
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
