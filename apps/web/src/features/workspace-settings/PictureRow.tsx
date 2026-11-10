import { Button, SettingsRow, Text, useAnnounce } from '@circi/ui'
import { useRef, useState, type ChangeEvent } from 'react'

import { workspaceLetter } from '#app/shell-model.ts'
import { SaveNote } from '#lib/SaveNote.tsx'

import { useSaveWorkspacePicture } from './api.ts'
import { pictureProblem } from './model.ts'

import styles from './PictureRow.module.css'

/**
 * The "Picture" row of the workspace's section: the picture (or its first letter), what it takes,
 * and Upload / Remove for owners and admins. The server checks the file again and resizes it.
 */
export function PictureRow({ workspace, name, picture, canManage }: PictureRow.Props) {
  const announce = useAnnounce()
  const save = useSaveWorkspacePicture(workspace)
  const input = useRef<HTMLInputElement>(null)
  const [problem, setProblem] = useState<string | null>(null)

  function choose(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const refused = pictureProblem(file)
    setProblem(refused)
    if (refused) return
    save.mutate(file, { onSuccess: () => announce('Picture saved') })
  }

  const error = problem ?? save.error?.message ?? null

  return (
    <SettingsRow>
      <div className={styles.row}>
        <span className={styles.logo} aria-hidden="true">
          {picture ? <img src={picture} alt="" className={styles.image} /> : workspaceLetter(name)}
        </span>
        <div className={styles.text}>
          <Text>Picture</Text>
          {error ? (
            <Text variant="small" tone="rejected" role="alert">
              {error}
            </Text>
          ) : (
            <Text variant="small" tone="tertiary">
              At least 128 px on the short side; it's cropped to a square. PNG, JPEG or WebP up to 1
              MB. Without one, CirCI shows the first letter.
            </Text>
          )}
          {save.isPending || save.isSuccess ? <SaveNote mutation={save} /> : null}
        </div>
        {canManage ? (
          <div className={styles.actions}>
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              aria-label="Choose a picture"
              onChange={choose}
            />
            {picture ? (
              <Button
                variant="ghost"
                disabled={save.isPending}
                onClick={() => {
                  setProblem(null)
                  save.mutate(null, { onSuccess: () => announce('Picture removed') })
                }}
              >
                Remove
              </Button>
            ) : null}
            <Button loading={save.isPending} onClick={() => input.current?.click()}>
              {picture ? 'Replace picture' : 'Upload picture'}
            </Button>
          </div>
        ) : null}
      </div>
    </SettingsRow>
  )
}

export namespace PictureRow {
  export interface Props {
    workspace: string
    name: string
    /** Where the picture is served from; null: none yet. */
    picture: string | null
    canManage: boolean
  }
}
