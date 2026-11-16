import { Banner, Button, SettingsSection } from '@circi/ui'
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

import styles from './SectionForm.module.css'

interface Group {
  /** The section that changed last and still has changes: its Save is the page's primary button. */
  primary: string | undefined
  mark: (id: string, dirty: boolean) => void
}

const GroupContext = createContext<Group | null>(null)

/**
 * Around the sections of one page: each `SectionForm` reports whether it has changes, and only the
 * one edited last gets a primary Save (a page has one primary button; the other sections' Save is
 * secondary until theirs is the latest).
 */
export function SectionFormGroup({ children }: { children: ReactNode }) {
  const [dirty, setDirty] = useState<readonly string[]>([])
  const mark = useCallback((id: string, isDirty: boolean) => {
    setDirty((list) => {
      const without = list.filter((x) => x !== id)
      if (isDirty) return list.includes(id) ? list : [...without, id]
      return without.length === list.length ? list : without
    })
  }, [])
  const value = useMemo(() => ({ primary: dirty.at(-1), mark }), [dirty, mark])
  return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>
}

/**
 * A settings section with its own Save and Discard, for fields that change how builds are judged.
 * The buttons appear only while the section has changes, and stick to the bottom of the scrolling
 * panel while any of the section is in view, so they are never far from the field being edited.
 */
export function SectionForm({
  id,
  title,
  description,
  dirty,
  pending,
  canManage,
  error,
  onSave,
  onDiscard,
  children,
}: SectionForm.Props) {
  const group = useContext(GroupContext)
  const mark = group?.mark
  useEffect(() => {
    mark?.(id, dirty)
    return () => mark?.(id, false)
  }, [mark, id, dirty])
  const primary = group ? group.primary === id : true

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    onSave()
  }

  return (
    <form onSubmit={submit} noValidate aria-label={title} className={styles.form}>
      <SettingsSection title={title} description={description}>
        {children}
      </SettingsSection>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {canManage && dirty ? (
        <div className={styles.footer} data-save-bar="">
          <Button type="button" variant="ghost" onClick={onDiscard} disabled={pending}>
            Discard
          </Button>
          <Button
            type="submit"
            variant={primary ? 'primary' : 'secondary'}
            loading={pending}
            aria-label={`Save ${title.toLowerCase()}`}
          >
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      ) : null}
    </form>
  )
}

export namespace SectionForm {
  export interface Props {
    /** Keys the section among the page's (its Save is told apart by it). */
    id: string
    title: string
    description?: ReactNode
    dirty: boolean
    pending: boolean
    canManage: boolean
    /** What the server refused without naming a field. */
    error?: string | null
    onSave: () => void
    onDiscard: () => void
    children: ReactNode
  }
}
