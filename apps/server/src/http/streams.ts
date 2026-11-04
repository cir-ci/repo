import { Transform } from 'node:stream'

export class TooLargeError extends Error {
  constructor(max: number) {
    super(`more than ${max} bytes`)
    this.name = 'TooLargeError'
  }
}

/** Passes bytes through until `max`, then fails the stream with TooLargeError. */
export function byteLimit(max: number): Transform {
  let seen = 0
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length
      cb(seen > max ? new TooLargeError(max) : null, chunk)
    },
  })
}
