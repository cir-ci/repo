import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

/**
 * The find fields of the list pages without a DOM: how long typing waits before it is committed,
 * which text matches, and the hooks that keep the text in step with where it is stored (the
 * address, or a builds filter).
 */

/** How long typing pauses before the text is committed (to the address, or to a request). */
export const FIND_DEBOUNCE_MS = 250

/** Whether `fields` (any of them) contain every word of `query`, in any case; everything matches a blank query. */
export function matchesFind(
  query: string,
  fields: ReadonlyArray<string | null | undefined>,
): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = fields.filter(Boolean).join('\n').toLowerCase()
  return words.every((w) => haystack.includes(w))
}

/** Items that match `query` in any of the fields `fields` names for them; all of them for a blank query. */
export function findIn<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => ReadonlyArray<string | null | undefined>,
): T[] {
  return query.trim() === '' ? [...items] : items.filter((i) => matchesFind(query, fields(i)))
}

/** An address's `q`: text, whatever the URL parser made of it ("148" arrives as a number). */
export function findParam(value: unknown): string {
  if (typeof value === 'string') return value
  return typeof value === 'number' ? String(value) : ''
}

/**
 * The text of a find field, in step with a stored value. Typing shows at once; the stored value
 * follows after a pause (or at once when the field is cleared); a change from outside (back,
 * a link, the filter being cleared) replaces the text.
 */
export function useFindText(
  stored: string,
  commit: (next: string) => void,
): readonly [string, (next: string) => void] {
  const [text, setText] = useState(stored)
  const synced = useRef(stored)
  const latest = useRef(commit)
  useEffect(() => {
    latest.current = commit
  })

  useEffect(() => {
    if (stored !== synced.current) {
      synced.current = stored
      setText(stored)
    }
  }, [stored])

  useEffect(() => {
    if (text === synced.current) return undefined
    const timer = setTimeout(
      () => {
        synced.current = text
        latest.current(text)
      },
      text === '' ? 0 : FIND_DEBOUNCE_MS,
    )
    return () => clearTimeout(timer)
  }, [text])

  return [text, setText]
}

/** The page's find text, kept in the address as `?q=` (replacing the entry, so Back leaves the page). */
export function useFindParam(): readonly [string, (next: string) => void] {
  const navigate = useNavigate()
  const stored = useRouterState({
    select: (s) => findParam((s.location.search as Record<string, unknown>)['q']),
  })
  return useFindText(stored, (next) => {
    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({ ...prev, q: next === '' ? undefined : next }),
      replace: true,
    })
  })
}
