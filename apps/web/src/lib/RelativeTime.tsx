import { useEffect, useState } from 'react'

import { formatAge, formatRelative } from './relative-time.ts'

/** The current time, refreshed every minute so relative times on an open page stay right. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/** The `<time>` of `iso` as a compact age ("2d"), for a narrow column; the exact time is on hover. */
export function Age({ iso }: RelativeTime.Props) {
  const now = useNow()
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString()}>
      {formatAge(iso, now)}
    </time>
  )
}

/** Primer RelativeTime: "3 minutes ago", with the exact time on hover. */
export function RelativeTime({ iso }: RelativeTime.Props) {
  const now = useNow()
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString()}>
      {formatRelative(iso, now)}
    </time>
  )
}

export namespace RelativeTime {
  export interface Props {
    iso: string
  }
}
