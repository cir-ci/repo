import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'

import { Parser } from 'tar'

import { contentTypeFor } from './mime.ts'
import { safeEntryPath, UnsafePathError } from './paths.ts'

/**
 * Reading an uploaded site tarball (PLAN §7.6). The archive is untrusted input, so only regular
 * files and directories are accepted: a symlink, hard link, device or FIFO anywhere rejects the
 * whole upload, as does any path that isn't plainly inside the site (see `safeEntryPath`), a
 * duplicate path, or more files or bytes than the limits allow.
 */

export class IngestError extends Error {
  readonly code:
    | 'unsafe-entry'
    | 'unsafe-path'
    | 'too-large'
    | 'too-many-files'
    | 'bomb'
    | 'invalid'
    | 'duplicate'
  constructor(code: IngestError['code'], message: string) {
    super(message)
    this.name = 'IngestError'
    this.code = code
  }
}

export namespace ingestTarball {
  export interface File {
    path: string
    sha256: string
    size: number
    contentType: string
  }

  export interface Options {
    /** Most uncompressed bytes in the whole site. */
    maxBytes: number
    /** Most files. Default 20,000. */
    maxFiles?: number
    /** Largest single file. Default `maxBytes`. */
    maxFileBytes?: number
    /** Most uncompressed bytes per compressed byte: a zip-bomb guard. Default 100. */
    maxRatio?: number
    /** Called once per file with its bytes, which hash to `sha256`. Store them. */
    store(file: ingestTarball.File, content: Buffer): Promise<void>
  }
}

export async function ingestTarball(
  input: Readable,
  options: ingestTarball.Options,
): Promise<ingestTarball.File[]> {
  const maxFiles = options.maxFiles ?? 20_000
  const maxFileBytes = options.maxFileBytes ?? options.maxBytes
  const maxRatio = options.maxRatio ?? 100
  const seen = new Set<string>()
  const result: ingestTarball.File[] = []
  const pending: Promise<void>[] = []
  let compressed = 0
  let total = 0
  let failure: IngestError | undefined

  const fail = (err: IngestError, source: Readable, parser: Parser) => {
    failure ??= err
    source.unpipe(parser)
    source.resume()
    parser.abort(err)
  }

  await new Promise<void>((resolve, reject) => {
    const parser = new Parser({ strict: false })
    input.on('data', (chunk: Buffer) => {
      compressed += chunk.length
    })
    input.on('error', reject)
    parser.on('error', (err) =>
      reject(failure ?? new IngestError('invalid', `Not a readable tar archive: ${err.message}`)),
    )
    parser.on('end', () => resolve())
    parser.on('abort', () =>
      reject(failure ?? new IngestError('invalid', 'The archive could not be read')),
    )

    parser.on('entry', (entry) => {
      if (failure) {
        entry.resume()
        return
      }
      if (entry.type === 'Directory') {
        try {
          // Directories still have to be inside the site, even though nothing is stored for them.
          if (entry.path.replace(/\/+$/, '') !== '.' && entry.path.replace(/\/+$/, '') !== '') {
            safeEntryPath(entry.path)
          }
        } catch (err) {
          if (err instanceof UnsafePathError)
            fail(new IngestError('unsafe-path', err.message), input, parser)
        }
        entry.resume()
        return
      }
      if (entry.type !== 'File' && entry.type !== 'OldFile' && entry.type !== 'ContiguousFile') {
        fail(
          new IngestError(
            'unsafe-entry',
            `"${entry.path}" is a ${entry.type}: only regular files and directories are accepted`,
          ),
          input,
          parser,
        )
        entry.resume()
        return
      }
      let path: string
      try {
        path = safeEntryPath(entry.path)
      } catch (err) {
        fail(
          new IngestError('unsafe-path', err instanceof Error ? err.message : String(err)),
          input,
          parser,
        )
        entry.resume()
        return
      }
      if (seen.has(path)) {
        fail(new IngestError('duplicate', `"${path}" appears twice in the archive`), input, parser)
        entry.resume()
        return
      }
      seen.add(path)
      if (seen.size > maxFiles) {
        fail(new IngestError('too-many-files', `More than ${maxFiles} files`), input, parser)
        entry.resume()
        return
      }
      if (entry.size > maxFileBytes) {
        fail(
          new IngestError('too-large', `"${path}" is larger than ${maxFileBytes} bytes`),
          input,
          parser,
        )
        entry.resume()
        return
      }

      const chunks: Buffer[] = []
      let size = 0
      entry.on('data', (chunk: Buffer) => {
        if (failure) return
        size += chunk.length
        total += chunk.length
        if (total > options.maxBytes) {
          fail(
            new IngestError('too-large', `The site is larger than ${options.maxBytes} bytes`),
            input,
            parser,
          )
          return
        }
        if (size > maxFileBytes) {
          fail(
            new IngestError('too-large', `"${path}" is larger than ${maxFileBytes} bytes`),
            input,
            parser,
          )
          return
        }
        // Mostly-zero archives expand enormously from a few bytes: judge the ratio as we go.
        if (total > 1024 * 1024 && total > Math.max(compressed, 1) * maxRatio) {
          fail(
            new IngestError('bomb', 'The archive expands far more than a real site would'),
            input,
            parser,
          )
          return
        }
        chunks.push(chunk)
      })
      entry.on('end', () => {
        if (failure) return
        const content = Buffer.concat(chunks)
        const file: ingestTarball.File = {
          path,
          sha256: createHash('sha256').update(content).digest('hex'),
          size: content.length,
          contentType: contentTypeFor(path),
        }
        result.push(file)
        pending.push(options.store(file, content))
      })
    })
    input.pipe(parser)
  })

  if (failure) throw failure
  await Promise.all(pending)
  return result
}
