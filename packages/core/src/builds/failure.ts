/**
 * Groups the messages builds ended in `error` with, for Insights. The known producers are
 * `describeStall` (services/builds/lifecycle.ts), the pipeline's image errors (`@circi/diff`) and
 * the worker's own giving-up message; each gets one stable label so a shard count or a name in the
 * text does not split a group. Anything else is grouped by its first sentence with numbers
 * replaced.
 */
export function failureGroup(message: string | null): { key: string; label: string } {
  const text = (message ?? '').trim()
  if (text === '') return { key: 'none', label: 'No message was recorded' }
  if (/^the upload never finished/i.test(text)) {
    return {
      key: 'upload-never-finished',
      label: 'Upload never finished: the CI job stopped before sending the screenshot list',
    }
  }
  if (/^timed out waiting for/i.test(text)) {
    return { key: 'timed-out-shards', label: 'Timed out waiting for shards' }
  }
  if (/^not a readable image|^expected a png/i.test(text)) {
    return { key: 'invalid-image', label: "A screenshot file isn't a valid image" }
  }
  const sentence = (text.split(/[.:\n]/, 1)[0] ?? text).trim()
  const label = sentence.replace(/\d+/g, '#').slice(0, 120)
  return { key: label.toLowerCase(), label: label.charAt(0).toUpperCase() + label.slice(1) }
}

export interface FailureTally {
  message: string
  builds: number
}

/** Counts failed builds' messages by group, most common first (ties by label), at most `limit`. */
export function tallyFailures(messages: readonly (string | null)[], limit = 5): FailureTally[] {
  const groups = new Map<string, FailureTally>()
  for (const m of messages) {
    const { key, label } = failureGroup(m)
    const group = groups.get(key) ?? { message: label, builds: 0 }
    group.builds += 1
    groups.set(key, group)
  }
  return [...groups.values()]
    .toSorted((a, b) => b.builds - a.builds || a.message.localeCompare(b.message))
    .slice(0, limit)
}
