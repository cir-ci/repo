import { Avatar, Button, Kbd, Text } from '@circi/ui'
import { type Ref, useId, useState } from 'react'

import { isSubmitKey } from '#lib/shortcuts.ts'

import {
  insertMention,
  matchMembers,
  mentionAt,
  type MentionMember,
  mentionHandle,
} from './mentions.ts'

import styles from './Discussion.module.css'

/**
 * A comment field with @mention autocomplete. Typing `@` lists matching members; ↑ ↓ choose,
 * Enter or Tab insert, Esc closes the list. ⌘↵ sends. The textarea is a combobox over the list,
 * so a screen reader hears the options.
 */
export function Composer(props: Composer.Props) {
  const { members, label, initial = '', submitLabel, pending, onSubmit, onCancel, inputRef } = props
  const [text, setText] = useState(initial)
  const [caret, setCaret] = useState(initial.length)
  const [active, setActive] = useState(0)
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const id = useId()
  const listId = `${id}-mentions`

  const token = mentionAt(text, caret)
  const options = token && dismissedAt !== token.start ? matchMembers(members, token.query) : []
  const open = token !== null && options.length > 0
  const activeOption = options[Math.min(active, options.length - 1)]

  function choose(member: MentionMember, el: HTMLTextAreaElement | null) {
    if (!token) return
    const next = insertMention(text, token, mentionHandle(member, members))
    setText(next.text)
    setCaret(next.caret)
    setActive(0)
    // The caret is set once React has written the new value.
    requestAnimationFrame(() => el?.setSelectionRange(next.caret, next.caret))
  }

  function send() {
    const body = text.trim()
    if (!body || pending) return
    onSubmit(body, () => {
      setText('')
      setCaret(0)
    })
  }

  return (
    <div className={styles.composer}>
      <label htmlFor={id}>
        <Text variant="small" tone="secondary">
          {label}
        </Text>
      </label>
      {props.context}
      <textarea
        id={id}
        ref={inputRef}
        className={styles.textarea}
        rows={3}
        value={text}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeOption ? `${id}-${activeOption.userId}` : undefined}
        aria-autocomplete="list"
        placeholder={props.placeholder ?? 'Write a comment. @ mentions a member.'}
        onChange={(e) => {
          setText(e.target.value)
          setCaret(e.target.selectionStart)
          setActive(0)
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (isSubmitKey(e)) {
            e.preventDefault()
            send()
          } else if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault()
            const delta = e.key === 'ArrowDown' ? 1 : options.length - 1
            setActive((a) => (a + delta) % options.length)
          } else if (open && (e.key === 'Enter' || e.key === 'Tab') && activeOption) {
            e.preventDefault()
            choose(activeOption, e.currentTarget)
          } else if (open && e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            if (token) setDismissedAt(token.start)
          } else if (e.key === 'Escape' && onCancel) {
            onCancel()
          }
        }}
      />
      {open ? (
        <ul id={listId} role="listbox" aria-label="Members" className={styles.mentions}>
          {options.map((m, i) => (
            <li
              key={m.userId}
              id={`${id}-${m.userId}`}
              role="option"
              aria-selected={m === activeOption}
              // The textarea keeps focus: a click must not blur it before the choice lands.
              onMouseDown={(e) => {
                e.preventDefault()
                const field = document.getElementById(id)
                choose(m, field instanceof HTMLTextAreaElement ? field : null)
              }}
              onMouseEnter={() => setActive(i)}
            >
              <Avatar name={m.name} size={18} />
              <Text>{m.name}</Text>
              <Text variant="small" tone="secondary">
                {m.email}
              </Text>
            </li>
          ))}
        </ul>
      ) : null}
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
    members: readonly MentionMember[]
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
    /** Shown between the label and the field (the region a comment is pinned to). */
    context?: React.ReactNode
  }
}
