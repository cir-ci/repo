import { Banner, Checkbox, FormDialog, LockIcon, Text, TextField } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { toast } from '#lib/toast.ts'

import { githubImportQuery, useImportRepositories } from './api/github-import.ts'
import { filterRepositories, importLabel, repositoryKey } from './github-import.ts'

import styles from './GithubImportDialog.module.css'

/**
 * Import from GitHub (the Projects page): the repositories the workspace's GitHub installation can
 * see and no project is linked to yet, to search and tick; each ticked one becomes a project named after
 * the repository, linked to it, with you as its member. All of them are made, or none.
 */
export function GithubImportDialog({ open, onClose, workspace }: GithubImportDialog.Props) {
  const list = useQuery({ ...githubImportQuery(workspace), enabled: open && workspace !== '' })
  const importer = useImportRepositories(workspace)
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())

  const repositories = list.data?.repositories ?? []
  const shown = filterRepositories(repositories, search)
  const chosen = repositories.filter((r) => picked.has(repositoryKey(r)))

  function close() {
    setSearch('')
    setPicked(new Set())
    importer.reset()
    onClose()
  }

  function toggle(key: string, on: boolean) {
    const next = new Set(picked)
    if (on) next.add(key)
    else next.delete(key)
    setPicked(next)
  }

  function submit() {
    if (chosen.length === 0) return
    importer.mutate(
      chosen.map((r) => ({ integration: r.integration, ref: r.ref })),
      {
        onSuccess: () => {
          toast(`Imported ${importLabel(chosen.length).replace('Import ', '')}`)
          close()
        },
      },
    )
  }

  return (
    <FormDialog
      open={open}
      onClose={close}
      onSubmit={submit}
      title="Import from GitHub"
      submitLabel={importLabel(chosen.length)}
      submitDisabled={chosen.length === 0}
      cancelVariant="ghost"
      pending={importer.isPending}
      noValidate
      formClassName={styles.form}
    >
      <TextField
        label="Find a repository"
        hideLabel
        placeholder="Find a repository"
        autoComplete="off"
        autoFocus
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {list.isPending ? (
        <Text variant="small" tone="tertiary" role="status">
          Loading repositories…
        </Text>
      ) : list.isError ? (
        <Banner tone="danger">{list.error.message}</Banner>
      ) : repositories.length === 0 ? (
        <Text variant="small" tone="tertiary">
          Every repository GitHub shares with CirCI already has a project.
        </Text>
      ) : shown.length === 0 ? (
        <Text variant="small" tone="tertiary">
          No repository matches “{search.trim()}”.
        </Text>
      ) : (
        <ul aria-label="Repositories" className={styles.choices}>
          {shown.map((r) => {
            const key = repositoryKey(r)
            return (
              <li key={key}>
                <Checkbox
                  className={styles.choice}
                  checked={picked.has(key)}
                  onCheckedChange={(on) => toggle(key, on)}
                  label={
                    <>
                      <Text as="span" variant="mono">
                        {r.ref}
                      </Text>
                      {r.private ? (
                        <LockIcon size={12} aria-label="Private repository" role="img" />
                      ) : null}
                    </>
                  }
                />
              </li>
            )
          })}
        </ul>
      )}
      {importer.error ? <Banner tone="danger">{importer.error.message}</Banner> : null}
    </FormDialog>
  )
}

export namespace GithubImportDialog {
  export interface Props {
    open: boolean
    onClose: () => void
    /** The workspace the projects are made in. */
    workspace: string
  }
}
