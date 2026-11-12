/** A flag or argument the admin CLI can't accept: `runCli` prints the command's usage, no stack. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

/** The pieces of a commander command `usageText` reads (kept structural so tests need no program). */
export interface CommandLike {
  name(): string
  usage(): string
  parent: CommandLike | null
}

/** `Usage: circi admin github link [options]`, built from the command up to the root. */
export function usageText(command: CommandLike | undefined): string {
  if (!command) return 'Run circi --help for the commands.'
  const path: string[] = []
  for (let c: CommandLike | null = command; c; c = c.parent) path.unshift(c.name())
  return `Usage: ${path.join(' ')} ${command.usage()}\nRun ${path.join(' ')} --help for the options.`
}

/** `--debug`, or a DEBUG that isn't empty, `0` or `false`. */
export function debugOn(argv: string[], env: Record<string, string | undefined>): boolean {
  const value = env.DEBUG
  return argv.includes('--debug') || (!!value && value !== '0' && value !== 'false')
}

/**
 * What the admin CLI prints for a failure: one `error:` line, plus the usage for a bad flag, plus
 * the stack only with `debug`. `expected` failures are ones whose message is enough on its own.
 */
export function describeFailure(
  err: unknown,
  options: { expected: boolean; debug: boolean; command?: CommandLike },
): string {
  const message = err instanceof Error ? err.message.split('\n')[0] : String(err)
  const lines = [`error: ${message}`]
  if (err instanceof UsageError) lines.push(usageText(options.command))
  if (options.debug && err instanceof Error && err.stack) lines.push(err.stack)
  else if (!options.expected && !(err instanceof UsageError)) {
    lines.push('(Run again with --debug, or set DEBUG=1, for the stack trace.)')
  }
  return lines.join('\n')
}
