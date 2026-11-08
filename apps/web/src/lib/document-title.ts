import { useEffect } from 'react'

/** Sets the browser tab title, most specific first: "Build #2 · web-app · CirCI". */
export function useDocumentTitle(...parts: (string | undefined)[]) {
  const title = [...parts.filter(Boolean), 'CirCI'].join(' · ')
  useEffect(() => {
    document.title = title
  }, [title])
}
