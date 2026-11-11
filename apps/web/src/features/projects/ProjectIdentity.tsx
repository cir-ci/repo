import type { Project } from '@circi/api'
import { Avatar, Radio, RadioGroup, SettingsRow, SettingsSection, Text, TextField } from '@circi/ui'
import { useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { branchProblem, slugProblem } from '#features/project-settings/settings-patch.ts'
import { useSaveAppearance, useSaveSettings } from '#features/projects/api/index.ts'
import { CheckedTextField } from '#lib/CheckedTextField.tsx'
import { IdentityFields } from '#lib/IdentityFields.tsx'
import { SaveNote } from '#lib/SaveNote.tsx'
import { toast } from '#lib/toast.ts'

import {
  appearancePatch,
  colourLabel,
  filterIcons,
  isProjectColor,
  isProjectIconName,
  PROJECT_COLORS,
  type ProjectColor,
} from './appearance.ts'
import { IconPicker } from './IconPicker.tsx'

import styles from './ProjectIdentity.module.css'

/**
 * The project's display settings in one row: the avatar (its popover holds the colours and icons, and
 * saves at once) and the name, URL slug and default branch beside it. Each text field saves with
 * its own ✓ through the settings PATCH, apart from the page's Save form: the name changes nobody's
 * workflow; the slug breaks links, so its warning stays under it; the default branch is where
 * baselines come from, and has the `#default-branch` anchor links point at.
 */
export function ProjectIdentity({
  workspace,
  project,
  name,
  slug,
  defaultBranch,
  appearance,
  canManage,
}: ProjectIdentity.Props) {
  const navigate = useNavigate()
  const saveName = useSaveSettings(workspace, project)
  const saveSlug = useSaveSettings(workspace, project)
  const saveBranch = useSaveSettings(workspace, project)
  const color: ProjectColor = isProjectColor(appearance.color) ? appearance.color : 'slate'
  const icon: string | null = isProjectIconName(appearance.icon) ? appearance.icon : null

  return (
    <SettingsSection title="Display Settings">
      <SettingsRow>
        <IdentityFields
          avatar={
            <Avatar
              type="project"
              slug={project}
              name={name}
              color={color}
              icon={icon}
              size={40}
              aria-hidden
            />
          }
          buttonLabel="Change icon and colour"
          panelLabel="Icon and colour"
          wide
          canEdit={canManage}
          panel={
            <AppearancePanel
              workspace={workspace}
              project={project}
              name={name}
              appearance={appearance}
              color={color}
              icon={icon}
            />
          }
        >
          <CheckedTextField
            label="Display Name"
            name="name"
            saved={name}
            disabled={!canManage}
            mutation={saveName}
            validate={(next) => (next ? null : 'Enter a name')}
            onCommit={(next) =>
              saveName.mutate({ name: next }, { onSuccess: () => toast('Project name saved') })
            }
          />
          <CheckedTextField
            label="URL Slug"
            name="slug"
            saved={slug}
            disabled={!canManage}
            mutation={saveSlug}
            description={
              <>
                Used in addresses and in <Text variant="mono">circi admin</Text> commands. Changing
                it breaks existing links.
              </>
            }
            dirtyDescription={
              <>
                Links with{' '}
                <Text variant="mono">
                  /{workspace}/{slug}
                </Text>{' '}
                in them stop working, including bookmarks and the links in existing pull request
                comments. New builds post the new address. The CI token keeps working.
              </>
            }
            validate={(next) => slugProblem(next, slug)}
            onCommit={(next) =>
              saveSlug.mutate(
                { slug: next },
                {
                  onSuccess: (result) => {
                    toast('URL slug saved')
                    // The address in the bar is the old one, which no longer works.
                    if (result.settings.slug !== project) {
                      void navigate({
                        to: '/$workspace/$project/settings/general',
                        params: { workspace, project: result.settings.slug },
                        replace: true,
                      })
                    }
                  },
                },
              )
            }
          />
          <div id="default-branch" className={styles.anchor}>
            <CheckedTextField
              label="Default Branch"
              name="defaultBranch"
              saved={defaultBranch}
              disabled={!canManage}
              mutation={saveBranch}
              description="Its approved builds are the baselines."
              validate={branchProblem}
              onCommit={(next) =>
                saveBranch.mutate(
                  { defaultBranch: next },
                  { onSuccess: () => toast('Default branch saved') },
                )
              }
            />
          </div>
        </IdentityFields>
      </SettingsRow>
    </SettingsSection>
  )
}

export namespace ProjectIdentity {
  export interface Props {
    workspace: string
    project: string
    name: string
    slug: string
    defaultBranch: string
    appearance: Project.Appearance
    canManage: boolean
  }
}

/** The popover's content: the colours, a search and the icon grid. Picking one saves at once. */
function AppearancePanel({
  workspace,
  project,
  name,
  appearance,
  color,
  icon,
}: AppearancePanel.Props) {
  const save = useSaveAppearance(workspace, project)
  const [query, setQuery] = useState('')
  const count = useMemo(() => filterIcons(query).length, [query])

  function pick(next: { color: ProjectColor; icon: string | null }) {
    const patch = appearancePatch(appearance, next)
    if (Object.keys(patch).length === 0) return
    save.mutate(patch, { onSuccess: () => toast('Icon and colour saved') })
  }

  return (
    <div className={styles.panel}>
      <div className={styles.swatchGroup}>
        <span aria-hidden="true" className={styles.legend}>
          Colour
        </span>
        <RadioGroup
          label="Colour"
          value={color}
          className={styles.swatches}
          onValueChange={(next) => {
            if (isProjectColor(next)) pick({ color: next, icon: appearance.icon })
          }}
        >
          {PROJECT_COLORS.map((c) => (
            <Radio
              key={c}
              value={c}
              aria-label={colourLabel(c)}
              title={colourLabel(c)}
              className={styles.swatch}
            >
              <span className={styles.dot} style={{ background: `var(--circi-project-${c})` }} />
            </Radio>
          ))}
        </RadioGroup>
      </div>
      <TextField
        label="Find an icon"
        hideLabel
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Find among ${count} icons`}
      />
      <IconPicker
        project={project}
        name={name}
        color={color}
        icon={icon}
        query={query}
        onPick={(next) => pick({ color, icon: next })}
      />
      <div className={styles.note}>
        <SaveNote mutation={save} />
      </div>
    </div>
  )
}

namespace AppearancePanel {
  export interface Props {
    workspace: string
    project: string
    name: string
    appearance: Project.Appearance
    color: ProjectColor
    icon: string | null
  }
}
