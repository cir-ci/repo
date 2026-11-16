import type { Project } from '@circi/api'
import { Avatar, Radio, RadioGroup, SettingsRow, SettingsSection, TextField } from '@circi/ui'
import { useEffect, useMemo, useRef, useState } from 'react'

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
 * The project's cosmetic settings in one row: the avatar (its popover holds the colours and icons, and
 * saves at once) and the display name beside it, which saves when it is left or Enter is pressed,
 * with Undo in its toast. The address and the default branch change how links and baselines work,
 * so they wait for Save in `ProjectDetailsSection`.
 */
export function ProjectIdentity({
  workspace,
  project,
  name,
  appearance,
  canManage,
}: ProjectIdentity.Props) {
  const saveName = useSaveSettings(workspace, project)
  const color: ProjectColor = isProjectColor(appearance.color) ? appearance.color : 'slate'
  const icon: string | null = isProjectIconName(appearance.icon) ? appearance.icon : null

  return (
    <SettingsSection title="Identity">
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
          buttonLabel="Change icon and color"
          panelLabel="Icon and color"
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
            label="Display name"
            name="name"
            saved={name}
            saveOn="blur"
            disabled={!canManage}
            mutation={saveName}
            validate={(next) => (next ? null : 'Enter a name')}
            onCommit={(next) => {
              const before = name
              saveName.mutate(
                { name: next },
                {
                  onSuccess: () =>
                    toast.undoable(`Renamed the project to ${next}`, () =>
                      saveName.mutateAsync({ name: before }),
                    ),
                },
              )
            }}
          />
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
    appearance: Project.Appearance
    canManage: boolean
  }
}

/** How long picking pauses before the choice is saved. */
const PICK_DELAY_MS = 500

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
  // What the cells show right away; the save follows once the picking pauses, so arrowing through
  // the icons (each step picks one) sends one PATCH and one toast, not one per step.
  const [chosen, setChosen] = useState({ color, icon })
  const pending = useRef<{ color: ProjectColor; icon: string | null } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef({ appearance, save })
  useEffect(() => {
    latest.current = { appearance, save }
  })

  function flush() {
    clearTimeout(timer.current)
    const next = pending.current
    pending.current = null
    if (!next) return
    const patch = appearancePatch(latest.current.appearance, next)
    if (Object.keys(patch).length === 0) return
    // mutateAsync, not mutate: it still reports when the popover closed meanwhile.
    void latest.current.save
      .mutateAsync(patch)
      .then(() => toast('Icon and color saved'))
      .catch(() => undefined) // the failed save toasts itself (meta.what)
  }
  // Closing the popover sends what was picked last.
  const flushRef = useRef(flush)
  useEffect(() => {
    flushRef.current = flush
  })
  useEffect(
    () => () => {
      flushRef.current()
    },
    [],
  )

  function pick(next: { color: ProjectColor; icon: string | null }) {
    setChosen(next)
    pending.current = next
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, PICK_DELAY_MS)
  }

  return (
    <div className={styles.panel}>
      <div className={styles.swatchGroup}>
        <span aria-hidden="true" className={styles.legend}>
          Color
        </span>
        <RadioGroup
          label="Color"
          value={chosen.color}
          className={styles.swatches}
          onValueChange={(next) => {
            if (isProjectColor(next)) pick({ color: next, icon: chosen.icon })
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
        color={chosen.color}
        icon={chosen.icon}
        query={query}
        onPick={(next) => pick({ color: chosen.color, icon: next })}
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
