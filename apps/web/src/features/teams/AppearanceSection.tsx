import type { Team } from '@circi/api'
import { SettingsRow, SettingsSection, Text, Avatar, TextField, useAnnounce } from '@circi/ui'
import { useMemo, useState } from 'react'

import { useSaveAppearance, useSaveSettings } from '#features/teams/api/index.ts'
import { InstantTextField } from '#lib/InstantTextField.tsx'
import { SaveNote } from '#lib/SaveNote.tsx'

import {
  appearancePatch,
  colourLabel,
  filterIcons,
  iconLabel,
  isTeamColor,
  isTeamIconName,
  TEAM_COLORS,
  type TeamColor,
} from './appearance.ts'
import { IconPicker } from './IconPicker.tsx'

import styles from './AppearanceSection.module.css'

/**
 * The team's name, colour and icon: what it is called and how it looks. None of it changes how
 * builds are judged, so each change is saved at once (owners and admins), with no Save button.
 */
export function AppearanceSection({
  workspace,
  team,
  name,
  appearance,
  canManage,
}: AppearanceSection.Props) {
  const save = useSaveAppearance(workspace, team)
  const rename = useSaveSettings(workspace, team)
  const announce = useAnnounce()
  const [query, setQuery] = useState('')
  const color: TeamColor = isTeamColor(appearance.color) ? appearance.color : 'slate'
  const icon: string | null = isTeamIconName(appearance.icon) ? appearance.icon : null
  const count = useMemo(() => filterIcons(query).length, [query])

  function pick(next: { color: TeamColor; icon: string | null }) {
    const patch = appearancePatch(appearance, next)
    if (Object.keys(patch).length === 0) return
    save.mutate(patch, { onSuccess: () => announce('Icon and colour saved') })
  }

  return (
    <SettingsSection
      title="Name, icon and colour"
      description="The colour only tells teams apart: it never means a build's state."
    >
      <SettingsRow>
        <InstantTextField
          label="Name"
          name="name"
          saved={name}
          disabled={!canManage}
          mutation={rename}
          validate={(next) => (next ? null : 'Enter a name')}
          onCommit={(next) =>
            rename.mutate({ name: next }, { onSuccess: () => announce('Team name saved') })
          }
        />
      </SettingsRow>
      <SettingsRow
        label={name}
        detail={`${colourLabel(color)}, ${icon ? iconLabel(icon).toLowerCase() : 'no icon'}`}
      >
        <Avatar type="team" slug={team} name={name} color={color} icon={icon ?? null} size={40} />
      </SettingsRow>
      {canManage ? (
        <SettingsRow>
          <div className={styles.pickers}>
            <fieldset className={styles.swatches}>
              <legend className={styles.legend}>Colour</legend>
              {TEAM_COLORS.map((c) => (
                <label key={c} className={styles.swatch} data-on={c === color ? '' : undefined}>
                  <input
                    type="radio"
                    name="team-colour"
                    value={c}
                    checked={c === color}
                    className={styles.radio}
                    onChange={() => pick({ color: c, icon: appearance.icon })}
                  />
                  <span className={styles.dot} style={{ background: `var(--circi-team-${c})` }} />
                  {colourLabel(c)}
                </label>
              ))}
            </fieldset>
            <div className={styles.iconHead}>
              <TextField
                label="Find an icon"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find an icon"
                className={styles.search}
              />
              <Text variant="small" tone="tertiary">
                {count} Lucide icons
              </Text>
            </div>
            <IconPicker
              team={team}
              name={name}
              color={color}
              icon={icon}
              query={query}
              onPick={(next) => pick({ color, icon: next })}
            />
            <SaveNote mutation={save} />
          </div>
        </SettingsRow>
      ) : null}
    </SettingsSection>
  )
}

export namespace AppearanceSection {
  export interface Props {
    workspace: string
    team: string
    name: string
    appearance: Team.Appearance
    canManage: boolean
  }
}
