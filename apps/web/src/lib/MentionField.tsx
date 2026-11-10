import { Avatar, SuggestTextarea, Text } from '@circi/ui'
import { type KeyboardEvent, type Ref, useId, useState } from 'react'

import { insertMention, matchMembers, mentionAt, type Mention, mentionHandle } from './mentions.ts'

/**
 * A textarea with @mention autocomplete, shared by the comment boxes and the region popover.
 * Typing `@` lists matching members in a popup under the field (`SuggestTextarea`, on Base UI's
 * Autocomplete: not clipped by what the field is in, flips above at the edge of the window); ↑ ↓
 * choose, Enter or Tab insert, Esc closes the list (and goes no further, so a popover or dialog
 * around it stays open). The textarea is a combobox over the list, so a screen reader hears the
 * options. Keys the list does not use go to `onKeyDown`.
 */
export function MentionField(props: MentionField.Props) {
  const { members, value, onChange, onKeyDown, inputRef, className, ...rest } = props
  const generated = useId()
  const id = props.id ?? generated
  const [caret, setCaret] = useState(value.length)
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)

  const token = mentionAt(value, caret)
  const options = token && dismissedAt !== token.start ? matchMembers(members, token.query) : []
  const suggestions = options.map((m) => ({
    id: m.userId,
    content: (
      <>
        <Avatar type="user" id={m.userId} name={m.name} image={m.image} size={18} />
        <Text>{m.name}</Text>
        <Text variant="small" tone="secondary">
          {m.email}
        </Text>
      </>
    ),
  }))

  function choose(userId: string) {
    const member = options.find((m) => m.userId === userId)
    if (!token || !member) return
    const next = insertMention(value, token, mentionHandle(member, members))
    onChange(next.text)
    setCaret(next.caret)
    // The caret is set once React has written the new value.
    requestAnimationFrame(() => {
      const field = document.getElementById(id)
      if (field instanceof HTMLTextAreaElement) field.setSelectionRange(next.caret, next.caret)
    })
  }

  return (
    <SuggestTextarea
      {...rest}
      id={id}
      inputRef={inputRef}
      className={className}
      listLabel="Members"
      suggestions={suggestions}
      open={token !== null}
      onDismiss={() => {
        if (token) setDismissedAt(token.start)
      }}
      onPick={(picked) => choose(picked.id)}
      value={value}
      onChange={(text, at) => {
        onChange(text)
        setCaret(at)
      }}
      onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
      onKeyDown={onKeyDown}
    />
  )
}

export namespace MentionField {
  export interface Props
    extends
      Omit<
        React.ComponentPropsWithoutRef<'textarea'>,
        'value' | 'onChange' | 'onKeyDown' | 'role' | 'ref'
      >,
      Pick<SuggestTextarea.Props, 'label' | 'hideLabel' | 'description' | 'error' | 'above'> {
    members: readonly Mention.Member[]
    value: string
    onChange: (value: string) => void
    onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void
    inputRef?: Ref<HTMLTextAreaElement> | undefined
  }
}
