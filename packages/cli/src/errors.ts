import { ApiError, NetworkError } from './api.ts'

/** A problem with how the CLI was called or configured (exit code 2, no stack trace). */
export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

/**
 * The one line to print for a failure, without the `error: ` prefix: what went wrong and, where
 * we can tell, what to do about it. Nothing here shows a stack; `reportError` adds that for
 * `--debug`.
 */
export function errorLine(err: unknown): string {
  if (err instanceof UsageError) return err.message
  if (err instanceof NetworkError) return `${err.message}. Check CIRCI_API_URL.`
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) {
      return `The server refused the token (${err.message}). Check that CIRCI_TOKEN is this project's CI token.`
    }
    return err.status >= 500
      ? `The server failed: ${err.message} (HTTP ${err.status})`
      : err.message
  }
  if (err instanceof SyntaxError) return `Invalid JSON: ${err.message}`
  if (err instanceof Error) {
    const code = 'code' in err && typeof err.code === 'string' ? err.code : undefined
    const path = 'path' in err && typeof err.path === 'string' ? err.path : undefined
    if (code === 'ENOENT' && path === 'git') return "Couldn't run git. Is it installed and on PATH?"
    if (code === 'ENOENT' && path) return `No such file or directory: ${path}`
    if (code === 'ENOTDIR' && path) return `Not a directory: ${path}`
    if (code === 'EISDIR' && path) return `Is a directory, not a file: ${path}`
    if ((code === 'EACCES' || code === 'EPERM') && path) return `Permission denied: ${path}`
    if (code === 'EMFILE') return 'Too many open files. Raise the limit (ulimit -n) and retry.'
    return err.message.split('\n')[0] || err.name
  }
  return String(err)
}

/** What to print for a failure: one line, plus the stack when `debug` is on. */
export function reportError(err: unknown, debug: boolean): string {
  const line = `error: ${errorLine(err)}`
  if (debug) return err instanceof Error && err.stack ? `${line}\n${err.stack}` : line
  const expected =
    err instanceof UsageError || err instanceof ApiError || err instanceof NetworkError
  return expected ? line : `${line}\n(Run again with --debug, or set DEBUG=1, for the stack trace.)`
}

/** `--debug` or a non-empty DEBUG other than `0`/`false`. */
export function debugOn(argv: string[], env: Record<string, string | undefined>): boolean {
  const value = env.DEBUG
  return argv.includes('--debug') || (!!value && value !== '0' && value !== 'false')
}
