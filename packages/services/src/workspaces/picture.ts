import { createHash } from 'node:crypto'

import {
  ValidationError,
  WORKSPACE_PICTURE_MAX_BYTES,
  WORKSPACE_PICTURE_MIN_SIDE,
  WORKSPACE_PICTURE_SIZE,
  workspacePictureKey,
} from '@circi/core'
import { type Database } from '@circi/db'
import { upsertServerFile } from '@circi/db/repositories'
import { InvalidImageError, makeWorkspacePicture } from '@circi/diff'
import { contentKey, type StorageDriver } from '@circi/storage'

/**
 * Turns an uploaded image into a workspace's picture: a 256 px square PNG, stored by its hash
 * like every other file. Returns the value for the workspace's `logo` (`picture:<sha256>`); the
 * caller sets it through better-auth. Nothing deletes the picture it replaces: with nothing
 * naming it any more, storage GC marks and collects it like any other unused file.
 *
 * A refused upload (too big, shorter than 128 px on its short side, not an image, not a PNG, JPEG or WebP) is a `ValidationError`.
 */
export async function storeWorkspacePicture(
  db: Database,
  storage: StorageDriver,
  input: storeWorkspacePicture.Input,
): Promise<storeWorkspacePicture.Result> {
  if (input.bytes.length === 0) throw new ValidationError('The picture is empty')
  if (input.bytes.length > WORKSPACE_PICTURE_MAX_BYTES) {
    throw new ValidationError('The picture is larger than 1 MB')
  }
  let png: Buffer
  try {
    ;({ png } = await makeWorkspacePicture(input.bytes, WORKSPACE_PICTURE_SIZE, {
      minSide: WORKSPACE_PICTURE_MIN_SIDE,
    }))
  } catch (err) {
    if (err instanceof InvalidImageError) throw new ValidationError(err.message)
    throw err
  }
  const sha256 = createHash('sha256').update(png).digest('hex')
  const stored = await db.transaction((tx) =>
    upsertServerFile(tx, {
      sha256,
      storageKey: contentKey(sha256),
      kind: 'asset',
      size: png.length,
      contentType: 'image/png',
      width: WORKSPACE_PICTURE_SIZE,
      height: WORKSPACE_PICTURE_SIZE,
    }),
  )
  // The row may be new, or left by an attempt that died before storing: put the bytes either way.
  await storage.put(stored.storageKey, png, { contentType: 'image/png', expectedSha256: sha256 })
  return { logo: workspacePictureKey(sha256), sha256, size: png.length }
}

export namespace storeWorkspacePicture {
  export interface Input {
    /** The uploaded bytes. */
    bytes: Buffer
  }

  export interface Result {
    /** What to store in the workspace's `logo`. */
    logo: string
    sha256: string
    size: number
  }
}
