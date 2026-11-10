import { Button, Text } from '@circi/ui'
import { useRef, useState, type ChangeEvent } from 'react'

import { SaveNote } from '#lib/SaveNote.tsx'

import { pictureProblem } from './model.ts'

import styles from './PicturePanel.module.css'

/**
 * What the workspace picture's popover holds: Upload or Replace, Remove, what a picture takes, and
 * the outcome. The file is checked here before it is sent; the server checks it again and resizes it.
 */
export function PicturePanel({ picture, mutation, onSave }: PicturePanel.Props) {
  const input = useRef<HTMLInputElement>(null)
  const [problem, setProblem] = useState<string | null>(null)

  function choose(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const refused = pictureProblem(file)
    setProblem(refused)
    if (refused) return
    onSave(file)
  }

  const error = problem ?? mutation.error?.message ?? null

  return (
    <div className={styles.panel}>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        aria-label="Choose a picture"
        onChange={choose}
      />
      <div className={styles.actions}>
        <Button loading={mutation.isPending} onClick={() => input.current?.click()}>
          {picture ? 'Replace picture' : 'Upload picture'}
        </Button>
        {picture ? (
          <Button
            variant="ghost"
            disabled={mutation.isPending}
            onClick={() => {
              setProblem(null)
              onSave(null)
            }}
          >
            Remove picture
          </Button>
        ) : null}
      </div>
      {error ? (
        <Text variant="small" tone="failed" role="alert">
          {error}
        </Text>
      ) : (
        <Text variant="small" tone="tertiary">
          At least 128 px on the short side; it's cropped to a square. PNG, JPEG or WebP up to 1 MB.
        </Text>
      )}
      {mutation.isPending || mutation.isSuccess ? <SaveNote mutation={mutation} /> : null}
    </div>
  )
}

export namespace PicturePanel {
  export interface Props {
    /** Where the picture is served from; null: none yet. */
    picture: string | null
    mutation: SaveNote.Props['mutation'] & { isPending: boolean; isSuccess: boolean }
    /** Upload this file, or remove the picture (null). */
    onSave: (file: File | null) => void
  }
}
