import type { InstanceAdmin } from '@circi/api'
import { Button, Dialog, TextField } from '@circi/ui'
import { type FormEvent, useState } from 'react'

import { toast } from '#lib/toast.ts'

import { emailAddressProblem, useChangeAccountEmail } from './api/admin.ts'

import styles from './Admin.module.css'

/**
 * An instance admin sets someone's email address directly: no confirmation mail, so it works on an
 * instance without mail and for a mailbox the person lost. Open while `account` is set.
 */
export function ChangeEmailDialog({ account, onClose }: ChangeEmailDialog.Props) {
  const change = useChangeAccountEmail()
  return (
    <Dialog
      open={account !== null}
      onOpenChange={(open) => {
        if (!open) {
          change.reset()
          onClose()
        }
      }}
      title={account ? `Change the email for ${account.name}` : 'Change email'}
      description="The new address takes effect at once, without a confirmation email. They stay signed in."
      actions={
        <>
          <Button
            onClick={() => {
              change.reset()
              onClose()
            }}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="change-account-email"
            variant="primary"
            loading={change.isPending}
          >
            Change email
          </Button>
        </>
      }
    >
      {account ? (
        <ChangeEmailForm
          key={account.id}
          account={account}
          error={change.error?.message}
          onChange={(email, done) =>
            change.mutate(
              { id: account.id, email },
              {
                onSuccess: (result) => {
                  toast(`Changed the email for ${account.name} to ${result.account.email}`)
                  done()
                  onClose()
                },
              },
            )
          }
        />
      ) : null}
    </Dialog>
  )
}

function ChangeEmailForm(props: {
  account: InstanceAdmin.Account
  error: string | undefined
  onChange: (email: string, done: () => void) => void
}) {
  const [email, setEmail] = useState(props.account.email)
  const [shown, setShown] = useState(false)
  const problem = emailAddressProblem(email)
  const same = email.trim().toLowerCase() === props.account.email.toLowerCase()

  function submit(e: FormEvent) {
    e.preventDefault()
    setShown(true)
    if (problem || same) return
    props.onChange(email, () => setShown(false))
  }

  return (
    <form id="change-account-email" onSubmit={submit} noValidate className={styles.fields}>
      <TextField
        label="Email"
        type="email"
        value={email}
        error={
          shown && problem
            ? problem
            : shown && same
              ? "That's already their email address"
              : props.error
        }
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="off"
      />
    </form>
  )
}

export namespace ChangeEmailDialog {
  export interface Props {
    /** The account to change; null keeps the dialog closed. */
    account: InstanceAdmin.Account | null
    onClose: () => void
  }
}
