import {
  type ColorMode,
  palettes,
  Radio,
  RadioGroup,
  SettingsRow,
  SettingsSection,
  Text,
  useColorScheme,
} from '@circi/ui'
import { type CSSProperties, useState } from 'react'

import { Frame } from '#features/workspace-settings/Frame.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'
import { toast } from '#lib/toast.ts'

import styles from '#features/workspace-settings/Settings.module.css'

const CHOICES = [
  { mode: 'system', label: 'System', help: 'Follows your computer' },
  { mode: 'light', label: 'Light', help: 'Near-white panel on warm grey' },
  { mode: 'dark', label: 'Dark', help: 'Dark panels on a near-black background' },
] as const satisfies readonly { mode: ColorMode; label: string; help: string }[]

const line = (width: string, color: string): CSSProperties => ({ width, background: color })

/** A tiny picture of the app in one scheme, drawn from that scheme's own palette. */
function Mock({ scheme }: { scheme: 'light' | 'dark' }) {
  const p = palettes[scheme]
  return (
    <span
      className={styles.mockHalf}
      style={{ background: p.surface.chrome }}
      data-mock-scheme={scheme}
    >
      <span className={styles.mockSide}>
        <span className={styles.mockLine} style={line('100%', p.surface.highest)} />
        <span className={styles.mockLine} style={line('70%', p.surface.highest)} />
        <span className={styles.mockLine} style={line('80%', p.surface.highest)} />
      </span>
      <span className={styles.mockPanel} style={{ background: p.surface.panel }}>
        <span className={styles.mockLine} style={line('40%', p.accent.main)} />
        <span className={styles.mockLine} style={line('100%', p.surface.highest)} />
        <span className={styles.mockLine} style={line('75%', p.surface.highest)} />
        <span className={styles.mockLine} style={line('22%', p.state.approved)} />
      </span>
    </span>
  )
}

/** System, light or dark, as three cards with a preview of each. Kept in this browser only. */
export function AppearancePage() {
  useDocumentTitle('Appearance')
  const { mode, setMode } = useColorScheme()
  const [saved, setSaved] = useState(false)
  return (
    <Frame crumbs={['Account', 'Appearance']}>
      <SettingsSection title="Theme">
        <SettingsRow>
          <RadioGroup
            label="Theme"
            value={mode}
            className={styles.cards}
            onValueChange={(next) => {
              const choice = CHOICES.find((c) => c.mode === next)
              if (!choice) return
              setMode(choice.mode)
              setSaved(true)
              toast(`Theme saved: ${choice.label}`)
            }}
          >
            {CHOICES.map((c) => (
              <Radio key={c.mode} value={c.mode} className={styles.card}>
                <span className={styles.mock} aria-hidden="true" style={{ padding: 0, gap: 0 }}>
                  {c.mode === 'system' ? (
                    <>
                      <Mock scheme="dark" />
                      <Mock scheme="light" />
                    </>
                  ) : (
                    <Mock scheme={c.mode} />
                  )}
                </span>
                <span className={styles.cardLabel}>
                  <span className={styles.dot} aria-hidden="true" />
                  {c.label}
                </span>
                <Text variant="small" tone="tertiary">
                  {c.help}
                </Text>
              </Radio>
            ))}
          </RadioGroup>
        </SettingsRow>
        <SettingsRow detail="Kept in this browser only. Screenshots under review always show on white.">
          {saved ? (
            <Text variant="small" tone="approved" role="status">
              Saved
            </Text>
          ) : null}
        </SettingsRow>
      </SettingsSection>
      <SettingsSection
        title="Switch quickly"
        description="Press ⌘K and type “theme”, or use the account menu at the bottom of the sidebar."
        bare
      />
    </Frame>
  )
}
