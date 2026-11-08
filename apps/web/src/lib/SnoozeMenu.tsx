import { Button, Dialog, Menu, TextField } from '@circi/ui'
import { type ReactElement, useState } from 'react'

import { customSnoozeDate, dateInputValue, type SnoozeChoice, snoozeOptions } from './snooze.ts'

/**
 * The one snooze menu (Inbox, Reviews, later Triage): Until next push, Tomorrow, Next week and a
 * custom date. `allowNextPush` is false where there is no push to wait for (notifications). The
 * open state can be controlled so the `H` shortcut opens it on its trigger.
 */
export function SnoozeMenu({
  trigger,
  onSnooze,
  allowNextPush = true,
  open,
  onOpenChange,
}: SnoozeMenu.Props) {
  const [picking, setPicking] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string>()
  const [min] = useState(() => dateInputValue(new Date(Date.now() + 24 * 3600 * 1000)))

  const submit = () => {
    const date = customSnoozeDate(value, new Date())
    if (!date) {
      setError('Pick a day from tomorrow on.')
      return
    }
    setPicking(false)
    onSnooze({ kind: 'date', date })
  }

  return (
    <>
      <Menu
        trigger={trigger}
        {...(open === undefined ? {} : { open })}
        {...(onOpenChange ? { onOpenChange } : {})}
        items={snoozeOptions(allowNextPush).map((o) => ({
          label: o.label,
          onSelect: () => {
            if (o.kind === 'date') {
              setValue('')
              setError(undefined)
              setPicking(true)
            } else onSnooze({ kind: o.kind })
          },
        }))}
      />
      <Dialog
        open={picking}
        onOpenChange={setPicking}
        title="Snooze until"
        actions={
          <>
            <Button onClick={() => setPicking(false)}>Cancel</Button>
            <Button variant="primary" onClick={submit}>
              Snooze
            </Button>
          </>
        }
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <TextField
            label="Date"
            type="date"
            value={value}
            min={min}
            error={error}
            onChange={(event) => {
              setValue(event.target.value)
              setError(undefined)
            }}
          />
        </form>
      </Dialog>
    </>
  )
}

export namespace SnoozeMenu {
  export interface Props {
    trigger: ReactElement<Record<string, unknown>>
    onSnooze: (choice: SnoozeChoice) => void
    allowNextPush?: boolean
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }
}
