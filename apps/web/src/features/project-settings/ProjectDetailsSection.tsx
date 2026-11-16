import type { Project } from '@circi/api'
import { SettingsRow, Text, TextField } from '@circi/ui'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { type useSaveSettings } from '#features/projects/api/index.ts'
import { toast } from '#lib/toast.ts'

import { SectionForm } from './SectionForm.tsx'
import { branchProblem, detailsPatch, slugProblem } from './settings-patch.ts'

import styles from './ProjectSettings.module.css'

/**
 * The project's address and default branch: they change how links and baselines work, so they save
 * together with Save (and Discard). The branch has the `#default-branch` anchor links point at.
 */
export function ProjectDetailsSection({
  workspace,
  project,
  settings,
  canManage,
  save,
}: ProjectDetailsSection.Props) {
  const navigate = useNavigate()
  const [slug, setSlug] = useState(settings.slug)
  const [branch, setBranch] = useState(settings.defaultBranch)
  const [shown, setShown] = useState(false)
  const dirty = slug.trim() !== settings.slug || branch.trim() !== settings.defaultBranch
  const problems = {
    slug: slugProblem(slug, settings.slug),
    branch: branchProblem(branch),
  }

  function discard() {
    setSlug(settings.slug)
    setBranch(settings.defaultBranch)
    setShown(false)
    save.reset()
  }

  return (
    <SectionForm
      id="details"
      title="Details"
      dirty={dirty}
      pending={save.isPending}
      canManage={canManage}
      error={save.error?.message}
      onDiscard={discard}
      onSave={() => {
        setShown(true)
        if (problems.slug || problems.branch) return
        save.mutate(detailsPatch({ slug, defaultBranch: branch }, settings), {
          onSuccess: (result) => {
            toast('Details saved')
            // The address in the bar is the old one, which no longer works.
            if (result.settings.slug !== project) {
              void navigate({
                to: '/$workspace/$project/settings/general',
                params: { workspace, project: result.settings.slug },
                replace: true,
              })
            }
          },
        })
      }}
    >
      <SettingsRow>
        <div className={styles.fields}>
          <TextField
            label="URL slug"
            name="slug"
            stacked
            value={slug}
            disabled={!canManage}
            error={shown ? problems.slug : null}
            onChange={(e) => {
              setSlug(e.target.value)
              if (save.isError) save.reset()
            }}
            description={
              slug.trim() !== settings.slug ? (
                <>
                  Links with{' '}
                  <Text variant="mono">
                    /{workspace}/{settings.slug}
                  </Text>{' '}
                  in them stop working, including bookmarks and the links in existing pull request
                  comments. New builds post the new address. The CI token keeps working.
                </>
              ) : (
                <>
                  Used in addresses and in <Text variant="mono">circi admin</Text> commands.
                  Changing it breaks existing links.
                </>
              )
            }
          />
          <div id="default-branch" className={styles.anchor}>
            <TextField
              label="Default branch"
              name="defaultBranch"
              stacked
              value={branch}
              disabled={!canManage}
              error={shown ? problems.branch : null}
              onChange={(e) => {
                setBranch(e.target.value)
                if (save.isError) save.reset()
              }}
              description="Its approved builds are the baselines."
            />
          </div>
        </div>
      </SettingsRow>
    </SectionForm>
  )
}

export namespace ProjectDetailsSection {
  export interface Props {
    workspace: string
    project: string
    settings: Project.Settings
    canManage: boolean
    save: ReturnType<typeof useSaveSettings>
  }
}
