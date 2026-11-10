import { Text } from '@circi/ui'

/**
 * The small inline outcome of a setting that saves as soon as it is changed: "Saving…", then
 * "Saved", or the reason it failed. Give it the mutation that does the save.
 */
export function SaveNote({ mutation }: SaveNote.Props) {
  if (mutation.status === 'pending') {
    return (
      <Text variant="small" tone="tertiary" role="status">
        Saving…
      </Text>
    )
  }
  if (mutation.status === 'success') {
    return (
      <Text variant="small" tone="approved" role="status">
        Saved
      </Text>
    )
  }
  if (mutation.status === 'error') {
    return (
      <Text variant="small" tone="rejected" role="alert">
        {mutation.error?.message ?? "Couldn't save that"}
      </Text>
    )
  }
  return null
}

export namespace SaveNote {
  export interface Props {
    mutation: {
      status: 'idle' | 'pending' | 'success' | 'error'
      error: Error | null
    }
  }
}
