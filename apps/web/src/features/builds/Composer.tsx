import { Button, Kbd, Text } from '@circi/ui'
import { type Ref, useEffect, useId, useState } from 'react'

import { MentionField } from '#lib/MentionField.tsx'
import type { Mention } from '#lib/mentions.ts'
import { isSubmitKey } from '#lib/shortcuts.ts'
import { useShortcutStore } from '#lib/stores/shortcut-store.ts'

import styles from './Discussion.module.css'

/**
 * A comment field with @mention autocomplete (`MentionField`). ⌘↵ sends, Esc cancels when the
 * list is closed. The textarea is a combobox over the list, so a screen reader hears the options.
 */
export function Composer(props: Composer.Props) {
  const { members, label, initial = '', submitLabel, pending, onSubmit, onCancel, inputRef } = props
  const [text, setText] = useState(initial)
  const id = useId()
  const { autoFocus = false } = props

  // A box opened on purpose (Reply, Edit) takes the cursor, so what is typed next lands in it.
  useEffect(() => {
    if (!autoFocus) return
    const field = document.getElementById(id)
    if (!(field instanceof HTMLTextAreaElement)) return
    field.focus()
    field.setSelectionRange(field.value.length, field.value.length)
  }, [autoFocus, id])

  // While this box holds unsent text, the shortcut layer keeps every plain key out of the page.
  const drafting = text.trim() !== ''
  useEffect(() => {
    const { setDrafting } = useShortcutStore.getState()
    setDrafting(id, drafting)
    return () => setDrafting(id, false)
  }, [id, drafting])

  function send() {
    const body = text.trim()
    if (!body || pending) return
    onSubmit(body, () => setText(''))
  }

  return (
    <div className={styles.composer}>
      <label htmlFor={id}>
        <Text variant="small" tone="secondary">
          {label}
        </Text>
      </label>
      {props.context}
      <MentionField
        id={id}
        members={members}
        inputRef={inputRef}
        className={styles.textarea}
        rows={3}
        value={text}
        placeholder={props.placeholder ?? 'Write a comment. @ mentions a member.'}
        onChange={setText}
        onKeyDown={(e) => {
          if (isSubmitKey(e)) {
            e.preventDefault()
            send()
          } else if (e.key === 'Escape' && onCancel) {
            onCancel()
          }
        }}
      />
      {props.error ? (
        <Text variant="small" tone="rejected" role="alert">
          {props.error}
        </Text>
      ) : null}
      <div className={styles.actions}>
        <Button
          variant="primary"
          size="sm"
          loading={pending}
          disabled={!text.trim()}
          onClick={send}
        >
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Text variant="small" tone="tertiary">
          <Kbd>⌘</Kbd> <Kbd>↵</Kbd>
        </Text>
      </div>
    </div>
  )
}

export namespace Composer {
  export interface Props {
    members: readonly Mention.Member[]
    /** The field's accessible name ("Comment", "Reply", "Edit comment"). */
    label: string
    initial?: string
    placeholder?: string
    submitLabel: string
    pending: boolean
    error?: string | undefined
    /** Called with the trimmed text; `clear` empties the field once it was accepted. */
    onSubmit: (body: string, clear: () => void) => void
    onCancel?: () => void
    inputRef?: Ref<HTMLTextAreaElement>
    /** Put the cursor in the field when it appears (a reply or an edit that was just opened). */
    autoFocus?: boolean
    /** Shown between the label and the field (the region a comment is pinned to). */
    context?: React.ReactNode
  }
}
