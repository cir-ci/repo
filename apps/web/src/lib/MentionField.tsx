import { Avatar, Text } from '@circi/ui'
import { type KeyboardEvent, type Ref, useId, useState } from 'react'

import { insertMention, matchMembers, mentionAt, type Mention, mentionHandle } from './mentions.ts'

import styles from './MentionField.module.css'

/**
 * A textarea with @mention autocomplete, shared by the comment boxes and the region popover.
 * Typing `@` lists matching members; ↑ ↓ choose, Enter or Tab insert, Esc closes the list (and
 * goes no further, so a popover or dialog around it stays open). The textarea is a combobox over
 * the list, so a screen reader hears the options. Keys the list does not use go to `onKeyDown`.
 */
export function MentionField(props: MentionField.Props) {
  const { members, value, onChange, onKeyDown, inputRef, className, ...rest } = props
  const generated = useId()
  const id = props.id ?? generated
  const listId = `${id}-mentions`
  const [caret, setCaret] = useState(value.length)
  const [active, setActive] = useState(0)
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)

  const token = mentionAt(value, caret)
  const options = token && dismissedAt !== token.start ? matchMembers(members, token.query) : []
  const open = token !== null && options.length > 0
  const activeOption = options[Math.min(active, options.length - 1)]

  function choose(member: Mention.Member, el: HTMLTextAreaElement | null) {
    if (!token) return
    const next = insertMention(value, token, mentionHandle(member, members))
    onChange(next.text)
    setCaret(next.caret)
    setActive(0)
    // The caret is set once React has written the new value.
    requestAnimationFrame(() => el?.setSelectionRange(next.caret, next.caret))
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      const delta = e.key === 'ArrowDown' ? 1 : options.length - 1
      setActive((a) => (a + delta) % options.length)
    } else if (open && (e.key === 'Enter' || e.key === 'Tab') && activeOption && !isSend(e)) {
      e.preventDefault()
      choose(activeOption, e.currentTarget)
    } else if (open && e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (token) setDismissedAt(token.start)
    } else {
      onKeyDown?.(e)
    }
  }

  return (
    <div className={styles.root}>
      <textarea
        {...rest}
        id={id}
        ref={inputRef}
        className={className}
        value={value}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeOption ? `${id}-${activeOption.userId}` : undefined}
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value)
          setCaret(e.target.selectionStart)
          setActive(0)
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={onKey}
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
              <Avatar type="user" id={m.userId} name={m.name} image={m.image} size={18} />
              <Text>{m.name}</Text>
              <Text variant="small" tone="secondary">
                {m.email}
              </Text>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** ⌘↵ and Ctrl+↵ send; they are never a choice from the list. */
const isSend = (e: KeyboardEvent) => e.key === 'Enter' && (e.metaKey || e.ctrlKey)

export namespace MentionField {
  export interface Props extends Omit<
    React.ComponentPropsWithoutRef<'textarea'>,
    'value' | 'onChange' | 'onKeyDown' | 'role' | 'ref'
  > {
    members: readonly Mention.Member[]
    value: string
    onChange: (value: string) => void
    onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void
    inputRef?: Ref<HTMLTextAreaElement> | undefined
  }
}
