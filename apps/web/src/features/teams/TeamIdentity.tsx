import type { Team } from '@circi/api'
import { Avatar, SettingsRow, SettingsSection, TextField } from '@circi/ui'
import { useMemo, useState } from 'react'

import { useSaveAppearance, useSaveSettings } from '#features/teams/api/index.ts'
import { IdentityEditor } from '#lib/IdentityEditor.tsx'
import { SaveNote } from '#lib/SaveNote.tsx'
import { toast } from '#lib/toast.ts'

import {
  appearancePatch,
  colourLabel,
  filterIcons,
  isTeamColor,
  isTeamIconName,
  TEAM_COLORS,
  type TeamColor,
} from './appearance.ts'
import { IconPicker } from './IconPicker.tsx'

import styles from './TeamIdentity.module.css'

/**
 * The team's name, colour and icon, in one row: the avatar opens the colours and icons, the name
 * sits beside it. None of it changes how builds are judged, so each change is saved at once
 * (owners and admins), with no Save button.
 */
export function TeamIdentity({ workspace, team, name, appearance, canManage }: TeamIdentity.Props) {
  const rename = useSaveSettings(workspace, team)
  const color: TeamColor = isTeamColor(appearance.color) ? appearance.color : 'slate'
  const icon: string | null = isTeamIconName(appearance.icon) ? appearance.icon : null

  return (
    <SettingsSection title="Name and picture">
      <SettingsRow>
        <IdentityEditor
          avatar={
            <Avatar
              type="team"
              slug={team}
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
              team={team}
              name={name}
              appearance={appearance}
              color={color}
              icon={icon}
            />
          }
          name="name"
          saved={name}
          mutation={rename}
          validate={(next) => (next ? null : 'Enter a name')}
          onCommit={(next) =>
            rename.mutate({ name: next }, { onSuccess: () => toast('Team name saved') })
          }
        />
      </SettingsRow>
    </SettingsSection>
  )
}

export namespace TeamIdentity {
  export interface Props {
    workspace: string
    team: string
    name: string
    appearance: Team.Appearance
    canManage: boolean
  }
}

/** The popover's content: the colours, a search and the icon grid. Picking one saves at once. */
function AppearancePanel({
  workspace,
  team,
  name,
  appearance,
  color,
  icon,
}: AppearancePanel.Props) {
  const save = useSaveAppearance(workspace, team)
  const [query, setQuery] = useState('')
  const count = useMemo(() => filterIcons(query).length, [query])

  function pick(next: { color: TeamColor; icon: string | null }) {
    const patch = appearancePatch(appearance, next)
    if (Object.keys(patch).length === 0) return
    save.mutate(patch, { onSuccess: () => toast('Icon and colour saved') })
  }

  return (
    <div className={styles.panel}>
      <fieldset className={styles.swatches}>
        <legend className={styles.legend}>Colour</legend>
        {TEAM_COLORS.map((c) => (
          <label key={c} className={styles.swatch} data-on={c === color ? '' : undefined}>
            <input
              type="radio"
              name="team-colour"
              value={c}
              checked={c === color}
              aria-label={colourLabel(c)}
              title={colourLabel(c)}
              className={styles.radio}
              onChange={() => pick({ color: c, icon: appearance.icon })}
            />
            <span className={styles.dot} style={{ background: `var(--circi-team-${c})` }} />
          </label>
        ))}
      </fieldset>
      <TextField
        label="Find an icon"
        hideLabel
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Find among ${count} icons`}
      />
      <IconPicker
        team={team}
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
    team: string
    name: string
    appearance: Team.Appearance
    color: TeamColor
    icon: string | null
  }
}
