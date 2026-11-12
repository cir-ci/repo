import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ApiError, NetworkError } from '#src/api.ts'
import { debugOn, errorLine, reportError, UsageError } from '#src/errors.ts'

import { closedAddress } from './support/closed-port.ts'

/** Runs a command to the end; a non-zero exit is a result, not a throw. */
function spawnAsync(
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string> },
): Promise<{ stdout: string; stderr: string; status: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('error', reject)
    child.on('close', (status) => resolve({ stdout, stderr, status }))
  })
}

const fsError = (code: string, path: string) =>
  Object.assign(new Error(`${code}: something, open '${path}'`), { code, path })

describe('errorLine', () => {
  it('maps the common failures to one actionable line', () => {
    expect(errorLine(new UsageError('Set CIRCI_TOKEN to the project CI token'))).toBe(
      'Set CIRCI_TOKEN to the project CI token',
    )
    expect(
      errorLine(
        new NetworkError('https://ci.acme.io/v1/project', 'ECONNREFUSED', 'connection refused'),
      ),
    ).toBe("Couldn't reach https://ci.acme.io (connection refused). Check CIRCI_API_URL.")
    expect(errorLine(new ApiError(401, 'Invalid token', undefined))).toBe(
      "The server refused the token (Invalid token). Check that CIRCI_TOKEN is this project's CI token.",
    )
    expect(errorLine(new ApiError(502, 'Bad Gateway', undefined))).toBe(
      'The server failed: Bad Gateway (HTTP 502)',
    )
    expect(errorLine(new ApiError(409, 'Build is already complete', undefined))).toBe(
      'Build is already complete',
    )
  })

  it('maps file-system errors to the path they are about', () => {
    expect(errorLine(fsError('ENOENT', './screenshotz'))).toBe(
      'No such file or directory: ./screenshotz',
    )
    expect(errorLine(fsError('ENOTDIR', './a.png'))).toBe('Not a directory: ./a.png')
    expect(errorLine(fsError('EACCES', './shots'))).toBe('Permission denied: ./shots')
    expect(errorLine(fsError('ENOENT', 'git'))).toBe(
      "Couldn't run git. Is it installed and on PATH?",
    )
  })

  it('keeps only the first line of anything else', () => {
    expect(errorLine(new Error('boom\n    at somewhere'))).toBe('boom')
    expect(errorLine(new SyntaxError('Unexpected token'))).toBe('Invalid JSON: Unexpected token')
    expect(errorLine('plain')).toBe('plain')
  })
})

describe('reportError', () => {
  const unexpected = new Error('boom')
  it('hides the stack, and says how to see it, for an unexpected error', () => {
    const text = reportError(unexpected, false)
    expect(text).toBe('error: boom\n(Run again with --debug, or set DEBUG=1, for the stack trace.)')
  })

  it('shows the stack with debug on', () => {
    expect(reportError(unexpected, true)).toMatch(/^error: boom\nError: boom\n\s+at /)
  })

  it('needs no hint for an error whose line says it all', () => {
    expect(reportError(new UsageError('--shard must look like 1/4'), false)).toBe(
      'error: --shard must look like 1/4',
    )
  })
})

describe('debugOn', () => {
  it('is --debug or a DEBUG that is not off', () => {
    expect(debugOn(['node', 'circi', '--debug'], {})).toBe(true)
    expect(debugOn([], { DEBUG: '1' })).toBe(true)
    expect(debugOn([], { DEBUG: 'false' })).toBe(false)
    expect(debugOn([], {})).toBe(false)
  })
})

describe('the circi command', () => {
  let cwd: string
  beforeAll(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'circi-cli-main-'))
  })
  afterAll(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  const main = join(import.meta.dirname, '..', 'src', 'main.ts')
  async function circi(args: string[], env: Record<string, string> = {}) {
    const { stdout, stderr, status } = await spawnAsync(process.execPath, [main, ...args], {
      cwd,
      env: { PATH: process.env.PATH ?? '', ...env },
    })
    return { code: status, stdout, stderr }
  }
  let address = ''
  beforeAll(async () => {
    address = await closedAddress()
  })
  const configured = () => ({ CIRCI_TOKEN: 't', CIRCI_API_URL: address })

  it('says which folder is missing, with exit code 2 and no stack', async () => {
    const result = await circi(['upload', './screenshotz'], configured())
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('error: No such directory: ./screenshotz')
    expect(result.stderr).not.toMatch(/\n\s+at /)
  })

  it('says which server it could not reach and what to check', async () => {
    const result = await circi(['site', 'upload', cwd], {
      ...configured(),
      CIRCI_COMMIT: 'a'.repeat(40),
    })
    expect(result.code).toBe(2)
    expect(result.stderr).toContain(
      `error: Couldn't reach ${address} (connection refused). Check CIRCI_API_URL.`,
    )
  })

  it('explains the exit codes in --help', async () => {
    const result = await circi(['upload', '--help'])
    expect(result.stdout).toMatch(
      /Exit codes:[\s\S]*0 {2}uploaded[\s\S]*1 {2}with --wait[\s\S]*2 {2}an error/,
    )
  })
})
