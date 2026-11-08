import type { Team } from '@circi/api'
import { Banner, Button, Text, TeamTile, TextField, useAnnounce } from '@circi/ui'
import { useState } from 'react'

import { useSaveAppearance } from './api.ts'
import {
  appearancePatch,
  colourLabel,
  filterIcons,
  iconLabel,
  isTeamColor,
  isTeamIconName,
  TEAM_COLORS,
  type TeamColor,
  type TeamIconName,
} from './appearance.ts'

import styles from './AppearanceSection.module.css'
import shared from './TeamSettings.module.css'

/** The tile's colour and icon. Each pick is saved at once (owners and admins). */
export function AppearanceSection({
  workspace,
  team,
  name,
  appearance,
  canManage,
}: AppearanceSection.Props) {
  const save = useSaveAppearance(workspace, team)
  const announce = useAnnounce()
  const [query, setQuery] = useState('')
  const color: TeamColor = isTeamColor(appearance.color) ? appearance.color : 'slate'
  const icon: TeamIconName | null = isTeamIconName(appearance.icon) ? appearance.icon : null
  const icons = filterIcons(query)

  function pick(next: { color: TeamColor; icon: string | null }) {
    const patch = appearancePatch(appearance, next)
    if (Object.keys(patch).length === 0) return
    save.mutate(patch, { onSuccess: () => announce('Icon and colour saved') })
  }

  return (
    <section className={shared.section} aria-labelledby="team-appearance">
      <div>
        <h2 id="team-appearance">Icon and colour</h2>
        <Text as="p" variant="small" tone="secondary" className={shared.lead}>
          How {name} shows in the sidebar, the switchers and every list. The colour only tells teams
          apart: it never means a build’s state.
        </Text>
      </div>
      <div className={shared.box}>
        <div className={shared.row}>
          <TeamTile name={name} color={color} {...(icon ? { icon } : {})} size={40} labelled />
          <span className={shared.rowText}>
            <Text>{name}</Text>
            <Text variant="small" tone="tertiary">
              {colourLabel(color)} with {icon ? `the ${iconLabel(icon)} icon` : 'its first letter'}.
              New teams get a colour from their name; change it here.
            </Text>
          </span>
        </div>
        {canManage ? (
          <div className={styles.pickers}>
            {save.error ? <Banner tone="danger">{save.error.message}</Banner> : null}
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
                Lucide icons. The first letter is used when no icon is set.
              </Text>
            </div>
            <div role="group" aria-label="Icon" className={styles.grid}>
              <Button
                variant="toggle"
                size="md"
                pressed={icon === null}
                onPressedChange={() => pick({ color, icon: null })}
                aria-label="First letter"
                title="First letter"
              >
                {name.trim()[0]?.toUpperCase() ?? '?'}
              </Button>
              {icons.map((i) => (
                <Button
                  key={i}
                  variant="toggle"
                  size="md"
                  pressed={icon === i}
                  onPressedChange={() => pick({ color, icon: i })}
                  aria-label={iconLabel(i)}
                  title={i}
                >
                  <TeamTile name={name} color={color} icon={i} size={20} />
                </Button>
              ))}
            </div>
            {icons.length === 0 ? (
              <Text variant="small" tone="tertiary">
                No icon matches “{query}”.
              </Text>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
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
