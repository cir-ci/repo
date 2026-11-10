import { Autocomplete as BaseAutocomplete } from '@base-ui/react/autocomplete'
import {
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useRef,
} from 'react'

import styles from './SuggestTextarea.module.css'

/**
 * A textarea that offers suggestions in a popup under it while the caller says so (`open`): the
 * @-mention picker. Base UI's `Autocomplete` renders the textarea as its input (a combobox) and
 * the list in a positioned popup that is not clipped by what the field sits in, flips above when
 * there is no room below and follows the field. Arrow keys move through the options (the active
 * one is scrolled into view), Enter or Tab picks the active one, Escape closes the list and goes
 * no further (a popover or dialog around the field stays open). ⌘/Ctrl+Enter is never a pick.
 *
 * The caller owns the text and what is suggested (it finds the word being completed and narrows
 * the options itself): the control does no filtering and writes nothing into the text on a pick.
 */
export function SuggestTextarea({
  suggestions,
  open,
  onDismiss,
  onPick,
  listLabel,
  value,
  onChange,
  onKeyDown,
  inputRef,
  className,
  ...rest
}: SuggestTextarea.Props) {
  const highlighted = useRef<SuggestTextarea.Suggestion | undefined>(undefined)
  const shown = open && suggestions.length > 0

  return (
    <BaseAutocomplete.Root
      items={suggestions}
      itemToStringValue={(s) => s.id}
      filter={null}
      mode="none"
      autoHighlight
      open={shown}
      onOpenChange={(next) => {
        if (!next) onDismiss()
      }}
      value={value}
      onItemHighlighted={(item) => {
        highlighted.current = item
      }}
    >
      <BaseAutocomplete.Input
        // Base UI types its input as an <input>; `render` makes it a <textarea>, whose props these are.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        {...(rest as BaseAutocomplete.Input.Props)}
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        ref={inputRef as Ref<HTMLInputElement> | undefined}
        className={className}
        render={<textarea />}
        onChange={(event) => {
          const field = event.currentTarget
          onChange(field.value, field.selectionStart ?? field.value.length)
        }}
        onKeyDown={(event) => {
          const mod = event.metaKey || event.ctrlKey
          if (event.key === 'Enter' && mod) event.preventBaseUIHandler()
          if (event.key === 'Tab' && !mod && shown && highlighted.current) {
            event.preventDefault()
            event.preventBaseUIHandler()
            onPick(highlighted.current)
            return
          }
          onKeyDown?.(event)
        }}
      />
      <BaseAutocomplete.Portal>
        <BaseAutocomplete.Positioner
          className={styles.positioner}
          side="bottom"
          align="start"
          sideOffset={2}
        >
          <BaseAutocomplete.Popup className={styles.popup}>
            <BaseAutocomplete.List aria-label={listLabel} className={styles.list}>
              {(item: SuggestTextarea.Suggestion) => (
                <BaseAutocomplete.Item
                  key={item.id}
                  value={item}
                  className={styles.item}
                  // The textarea keeps focus: a press must not blur it before the choice lands.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onPick(item)}
                >
                  {item.content}
                </BaseAutocomplete.Item>
              )}
            </BaseAutocomplete.List>
          </BaseAutocomplete.Popup>
        </BaseAutocomplete.Positioner>
      </BaseAutocomplete.Portal>
    </BaseAutocomplete.Root>
  )
}

export namespace SuggestTextarea {
  export interface Suggestion {
    id: string
    /** What the option shows. */
    content: ReactNode
  }
  export interface Props extends Omit<
    ComponentPropsWithoutRef<'textarea'>,
    'value' | 'onChange' | 'onKeyDown' | 'role' | 'ref' | 'className' | 'children'
  > {
    onKeyDown?: ((event: KeyboardEvent<HTMLElement>) => void) | undefined
    value: string
    /** The text, and where the caret is after the change. */
    onChange: (value: string, caret: number) => void
    /** What to suggest now. */
    suggestions: readonly Suggestion[]
    /** Whether the list is showing (it also needs at least one suggestion). */
    open: boolean
    /** Escape was pressed in the open list. */
    onDismiss: () => void
    /** An option was chosen, by click, Enter or Tab. */
    onPick: (suggestion: Suggestion) => void
    /** Names the list for assistive tech. */
    listLabel: string
    inputRef?: Ref<HTMLTextAreaElement> | undefined
    className?: string | undefined
  }
}
