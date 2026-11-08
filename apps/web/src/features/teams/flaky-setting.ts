/**
 * The team's "flaky screenshots block merges" control. The wire value is `true`, `false` or
 * `null` (inherit the workspace's); the control shows one of three choices.
 */

export type FlakyChoice = 'inherit' | 'on' | 'off'

export const choiceOf = (value: boolean | null): FlakyChoice =>
  value === null ? 'inherit' : value ? 'on' : 'off'

export const valueOf = (choice: FlakyChoice): boolean | null =>
  choice === 'inherit' ? null : choice === 'on'

/** The choices, with what "inherit" currently means spelled out. */
export function flakyChoices(workspaceValue: boolean): { value: FlakyChoice; label: string }[] {
  return [
    {
      value: 'inherit',
      label: `Inherit from workspace (currently: ${workspaceValue ? 'on' : 'off'})`,
    },
    { value: 'on', label: 'On' },
    { value: 'off', label: 'Off' },
  ]
}

export const isFlakyChoice = (value: string): value is FlakyChoice =>
  value === 'inherit' || value === 'on' || value === 'off'
